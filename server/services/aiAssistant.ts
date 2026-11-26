import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  ApprovedService,
  AssistantStructuredReply,
  HospitalSettings,
  LanguageCode,
} from '../../shared/domain.ts';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in server secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 18000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function formatGenAiError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw) as { error?: { code?: number; message?: string; status?: string } };
    if (parsed?.error?.message) {
      return new Error(parsed.error.message);
    }
  } catch {
    // Non-JSON error string; fall through.
  }
  if (raw.includes('aborted') || raw.includes('Timeout')) {
    return new Error('AI assistant request timed out while contacting Gemini. Please try again.');
  }
  return err instanceof Error ? err : new Error(raw);
}

async function callWithBriefRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTransient = msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('500');
    if (!isTransient) {
      throw formatGenAiError(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
    try {
      return await fn();
    } catch (retryErr) {
      throw formatGenAiError(retryErr);
    }
  }
}

export interface PatientAuthorizedRequestSummary {
  requestCode: string;
  serviceName: string;
  status: string;
  preferredTimeWindow: string;
  assignedNurseName: string | null;
  createdAt: string;
}

export async function generateBoundedAssistantReply(params: {
  message: string;
  language: LanguageCode;
  patientName: string;
  patientDefaultAddress: string;
  hospital: HospitalSettings;
  services: ApprovedService[];
  authorizedRequests: PatientAuthorizedRequestSummary[];
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
}): Promise<AssistantStructuredReply> {
  const ai = getAiClient();

  const serviceCatalog = params.services
    .filter((s) => s.isActive)
    .map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      nameUr: s.nameUr,
      category: s.category,
      durationMins: s.estimatedDurationMins,
      preparationNotes: s.preparationNotes,
      requiresPrescriptionNote: s.requiresPrescriptionNote,
    }));

  const systemInstruction = `
You are the HomeHeal Bilingual Patient Care Assistant for ${params.hospital.hospitalName} (${params.hospital.departmentName}).

STRICT SAFETY AND SCOPE BOUNDARIES:
1. SUPPORTED LANGUAGES: Respond in the user's selected language mode (${params.language === 'ur' ? 'Urdu script (اردو)' : params.language === 'roman_ur' ? 'Roman Urdu' : 'English'}), or match the user's language if they write clearly in English, Urdu, or Roman Urdu.
2. APPROVED SERVICES ONLY: Only explain and draft requests for East-City Hospital's active approved nursing services listed below. Do not invent services, prices, or policies.
3. NO DIAGNOSIS OR PRESCRIBING: Never provide medical diagnosis, symptom interpretation, medication prescriptions, dosage advice, or clinical treatment recommendations. If asked for diagnosis, treatment, or medication advice, politely decline (set outOfScopeBlocked=true) and advise consulting a licensed physician at East-City Hospital.
4. EMERGENCY ESCALATION: If the user describes chest pain, severe bleeding, unconsciousness, difficulty breathing, stroke symptoms, or an emergency, set emergencyEscalation=true, advise calling 1122 or visiting East-City Hospital Emergency immediately, and do NOT prepare a routine home nursing draft.
5. AUTHORIZED STATUS ONLY: Only quote request statuses from the authenticated patient's authorized request records provided below. Never invent or guess a request status or access any other patient's data.
6. DRAFT ONLY — NEVER AUTO-SUBMIT: You may prepare an editable request draft ("draft" object) when the patient wants to schedule an approved home nursing service, using the exact numeric serviceId and serviceCode from the catalog. Explicitly remind the patient that they must review the form, grant location consent, and press Confirm & Submit themselves. Always set requiresExplicitConfirmation=true.

EAST-CITY HOSPITAL INFO:
- Address: ${params.hospital.address}, ${params.hospital.city}
- Phone: ${params.hospital.phone}
- Operating Hours: ${params.hospital.operatingHours}
- Service Radius: ${params.hospital.serviceRadiusKm} km

APPROVED NURSING SERVICES CATALOG:
${JSON.stringify(serviceCatalog)}

AUTHENTICATED PATIENT: ${params.patientName}
DEFAULT ADDRESS: ${params.patientDefaultAddress || 'Not yet set'}
AUTHORIZED REQUEST RECORDS FOR THIS PATIENT ONLY:
${JSON.stringify(params.authorizedRequests)}
`.trim();

  const conversationContents = [
    ...params.history.slice(-6).map((h) => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.text }],
    })),
    {
      role: 'user',
      parts: [{ text: params.message }],
    },
  ];

  const response = await callWithBriefRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: conversationContents,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            replyText: {
              type: Type.STRING,
              description: 'Helpful, concise, empathetic response in the requested language.',
            },
            language: {
              type: Type.STRING,
              description: "One of 'en', 'ur', 'roman_ur'",
            },
            outOfScopeBlocked: {
              type: Type.BOOLEAN,
              description: 'True if user asked for medical diagnosis, prescribing, or unrelated patient records.',
            },
            emergencyEscalation: {
              type: Type.BOOLEAN,
              description: 'True if user mentioned urgent emergency symptoms requiring 1122 or ER visit.',
            },
            hasDraft: {
              type: Type.BOOLEAN,
              description: 'True only when user wants to prepare an editable home nursing service request draft.',
            },
            draftServiceId: {
              type: Type.INTEGER,
              description: 'Exact approved service ID from catalog, or 0 if no draft.',
            },
            draftServiceCode: {
              type: Type.STRING,
              description: 'Exact approved service code (e.g. SVC-IVD-02), or empty string.',
            },
            draftTimeWindow: {
              type: Type.STRING,
              description: 'Suggested time window like "14:00 - 16:00" or "Next Available Today".',
            },
            draftPatientNotes: {
              type: Type.STRING,
              description: 'Non-diagnostic logistics or preparation note for the nurse.',
            },
            draftPatientAddress: {
              type: Type.STRING,
              description: 'Patient address for the draft, defaulting to patient default address if known.',
            },
          },
          required: [
            'replyText',
            'language',
            'outOfScopeBlocked',
            'emergencyEscalation',
            'hasDraft',
            'draftServiceId',
            'draftServiceCode',
            'draftTimeWindow',
            'draftPatientNotes',
            'draftPatientAddress',
          ],
        },
      },
    }),
  );

  const rawText = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawText) as {
    replyText: string;
    language: string;
    outOfScopeBlocked: boolean;
    emergencyEscalation: boolean;
    hasDraft: boolean;
    draftServiceId: number;
    draftServiceCode: string;
    draftTimeWindow: string;
    draftPatientNotes: string;
    draftPatientAddress: string;
  };

  const validLang: LanguageCode =
    parsed.language === 'ur' || parsed.language === 'roman_ur' ? parsed.language : 'en';

  const matchedService = params.services.find(
    (s) => s.isActive && (s.id === parsed.draftServiceId || s.code === parsed.draftServiceCode),
  );

  const shouldIncludeDraft =
    parsed.hasDraft && !parsed.outOfScopeBlocked && !parsed.emergencyEscalation && Boolean(matchedService);

  return {
    replyText: parsed.replyText,
    language: validLang,
    outOfScopeBlocked: Boolean(parsed.outOfScopeBlocked),
    emergencyEscalation: Boolean(parsed.emergencyEscalation),
    requiresExplicitConfirmation: true,
    draft: shouldIncludeDraft && matchedService
      ? {
          serviceId: matchedService.id,
          serviceCode: matchedService.code,
          preferredTimeWindow: parsed.draftTimeWindow || 'Next Available Today',
          patientNotes: parsed.draftPatientNotes || '',
          patientAddress: parsed.draftPatientAddress || params.patientDefaultAddress || '',
        }
      : null,
  };
}

export async function generateSpeechWavBase64(params: {
  text: string;
  language: LanguageCode;
}): Promise<{ base64Wav: string; mimeType: string }> {
  const ai = getAiClient();
  const style =
    params.language === 'ur'
      ? 'Calm, warm healthcare coordinator speaking clearly in Urdu'
      : params.language === 'roman_ur'
        ? 'Calm, clear Pakistani healthcare coordinator speaking naturally'
        : 'Calm, clear, reassuring East-City Hospital nurse coordinator';

  const response = await callWithBriefRetry(() =>
    ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: params.text.slice(0, 600),
              speechMetadata: {
                style,
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    }),
  );

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error('Speech synthesis did not return audio data.');
  }
  return {
    base64Wav: base64Audio,
    mimeType: 'audio/wav',
  };
}

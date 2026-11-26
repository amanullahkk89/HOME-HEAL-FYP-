import { useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckSquare,
  Mic,
  MicOff,
  Send,
  ShieldAlert,
  Volume2,
  X,
} from 'lucide-react';
import {
  apiFetch,
  type AssistantDraft,
  type AssistantStructuredReply,
  type LanguageCode,
} from '../types/api.ts';

interface AiAssistantDrawerProps {
  open: boolean;
  onClose: () => void;
  token: string;
  initialLanguage: LanguageCode;
  onApplyDraft: (draft: AssistantDraft) => void;
}

interface AssistantTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  language: LanguageCode;
  outOfScopeBlocked?: boolean;
  emergencyEscalation?: boolean;
  draft?: AssistantDraft | null;
}

const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  en: 'English',
  ur: 'اردو (Urdu)',
  roman_ur: 'Roman Urdu',
};

const QUICK_PROMPTS: Record<LanguageCode, string[]> = {
  en: [
    'Explain IV drip setup service',
    'What is the status of my latest request?',
    'Prepare a draft for post-surgical wound dressing tomorrow morning',
  ],
  ur: [
    'آئی وی ڈرپ سیٹ اپ کی سروس کے بارے میں بتائیں',
    'میری درخواست کی موجودہ صورتحال کیا ہے؟',
    'انجیکشن لگوانے کی درخواست کا ڈرافٹ تیار کریں',
  ],
  roman_ur: [
    'IV drip setup service ke baray mein batayein',
    'Meri latest request ka status kya hai?',
    'Mujhe wound dressing ke liye kal subah ki request ka draft banana hai',
  ],
};

export function AiAssistantDrawer({
  open,
  onClose,
  token,
  initialLanguage,
  onApplyDraft,
}: AiAssistantDrawerProps) {
  const [language, setLanguage] = useState<LanguageCode>(initialLanguage);
  const [turns, setTurns] = useState<AssistantTurn[]>([
    {
      id: 'welcome',
      role: 'assistant',
      language: initialLanguage,
      text:
        initialLanguage === 'ur'
          ? 'السلام علیکم! میں ایسٹ سٹی ہسپتال کا ہوم ہیلتھ اسسٹنٹ ہوں۔ میں منظور شدہ نرسنگ سروسز کی وضاحت، آپ کی درخواستوں کا اسٹیٹس چیک کرنے، اور فارم کا ڈرافٹ تیار کرنے میں مدد کر سکتا ہوں۔'
          : initialLanguage === 'roman_ur'
            ? 'Assalam-o-Alaikum! Main East-City Hospital ka HomeHeal Assistant hoon. Main approved home nursing services samjha sakta hoon, aapki request ka status check kar sakta hoon, aur editable request draft bana sakta hoon.'
            : 'Hello! I am the East-City Hospital HomeHeal Assistant. I can explain approved home nursing services, check your authorized request statuses, and prepare an editable request draft for your review.',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  if (!open) return null;

  const sendMessage = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed || loading) return;
    setError(null);

    const userTurn: AssistantTurn = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: trimmed,
      language,
    };
    const nextTurns = [...turns, userTurn];
    setTurns(nextTurns);
    setInput('');
    setLoading(true);

    try {
      const reply = await apiFetch<AssistantStructuredReply>('/api/ai/assist', {
        method: 'POST',
        token,
        body: {
          message: trimmed,
          language,
          history: nextTurns.slice(-6).map((t) => ({ role: t.role, text: t.text })),
        },
      });

      setTurns((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: reply.replyText,
          language: reply.language,
          outOfScopeBlocked: reply.outOfScopeBlocked,
          emergencyEscalation: reply.emergencyEscalation,
          draft: reply.draft,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assistant request failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleVoiceInput = () => {
    const SpeechRec =
      (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => unknown })
        .webkitSpeechRecognition;

    if (!SpeechRec) {
      setError('Browser voice dictation is not supported in this browser; please type your message.');
      return;
    }

    const recognition = new SpeechRec() as {
      lang: string;
      interimResults: boolean;
      maxAlternatives: number;
      onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
      onerror: (() => void) | null;
      onend: (() => void) | null;
      start: () => void;
    };

    recognition.lang = language === 'ur' ? 'ur-PK' : 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    setListening(true);
    setError(null);

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (transcript) {
        setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
      }
    };
    recognition.onerror = () => {
      setListening(false);
      setError('Could not capture microphone audio. Please check microphone permissions.');
    };
    recognition.onend = () => {
      setListening(false);
    };
    recognition.start();
  };

  const handleSpeakReply = async (turn: AssistantTurn) => {
    setSpeakingId(turn.id);
    setError(null);
    try {
      const audioRes = await apiFetch<{ base64Wav: string; mimeType: string }>('/api/ai/tts', {
        method: 'POST',
        token,
        body: { text: turn.text, language: turn.language },
      });
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(`data:${audioRes.mimeType};base64,${audioRes.base64Wav}`);
      audioRef.current = audio;
      audio.onended = () => setSpeakingId(null);
      await audio.play();
    } catch {
      // Fallback to browser Web Speech synthesis if Gemini TTS is unavailable
      if ('speechSynthesis' in window) {
        const utter = new SpeechSynthesisUtterance(turn.text);
        utter.lang = turn.language === 'ur' ? 'ur-PK' : 'en-US';
        utter.onend = () => setSpeakingId(null);
        window.speechSynthesis.speak(utter);
      } else {
        setSpeakingId(null);
        setError('Voice playback unavailable in this environment.');
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="HomeHeal Bilingual Patient Care Assistant"
    >
      <div className="w-full max-w-lg bg-white h-full border-l border-slate-200 flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700">
              <Bot className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">HomeHeal Care Assistant</h2>
              <p className="text-xs text-slate-500">
                East-City Hospital · Guidance & Drafts Only (No Diagnosis)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close AI Assistant"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-600">Assistant Language:</span>
          <div className="flex items-center gap-1 p-1 bg-white border border-slate-200 rounded-lg">
            {(['en', 'ur', 'roman_ur'] as LanguageCode[]).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLanguage(code)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  language === code
                    ? 'bg-teal-700 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {LANGUAGE_LABELS[code]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/50">
          {turns.map((turn) => {
            const isRtl = turn.language === 'ur';
            return (
              <div
                key={turn.id}
                className={`flex flex-col ${turn.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  dir={isRtl ? 'rtl' : 'ltr'}
                  className={`max-w-[90%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                    turn.role === 'user'
                      ? 'bg-teal-700 text-white'
                      : 'bg-white border border-slate-200 text-slate-900'
                  }`}
                >
                  {turn.emergencyEscalation && (
                    <div className="mb-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-900 text-xs flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>
                        Emergency Notice: Call 1122 or go to East-City Hospital Emergency immediately.
                      </span>
                    </div>
                  )}

                  {turn.outOfScopeBlocked && (
                    <div className="mb-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
                      <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>
                        Clinical Scope Notice: HomeHeal Assistant cannot provide medical diagnosis or prescriptions.
                      </span>
                    </div>
                  )}

                  <p className="whitespace-pre-wrap">{turn.text}</p>

                  {turn.role === 'assistant' && (
                    <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => handleSpeakReply(turn)}
                        disabled={speakingId === turn.id}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-teal-700 transition-colors"
                      >
                        <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{speakingId === turn.id ? 'Playing...' : 'Listen'}</span>
                      </button>
                    </div>
                  )}
                </div>

                {turn.draft && (
                  <div className="mt-2 w-[90%] bg-teal-50 border border-teal-200 rounded-xl p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-teal-900">
                        Editable Request Draft Ready
                      </span>
                      <span className="text-[11px] font-mono text-teal-800">
                        {turn.draft.serviceCode}
                      </span>
                    </div>
                    <p className="text-xs text-teal-900">
                      Window: {turn.draft.preferredTimeWindow}
                      {turn.draft.patientAddress ? ` · ${turn.draft.patientAddress}` : ''}
                    </p>
                    {turn.draft.patientNotes && (
                      <p className="text-xs text-teal-800">Notes: {turn.draft.patientNotes}</p>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        onApplyDraft(turn.draft!);
                        onClose();
                      }}
                      className="w-full px-3 py-2 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors inline-flex items-center justify-center gap-1.5"
                    >
                      <CheckSquare className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Review Draft in Request Form (Requires Confirmation)</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {loading && (
            <div className="text-xs text-slate-500 bg-white border border-slate-200 rounded-xl px-4 py-3 w-fit">
              Checking East-City Hospital approved services and your authorized records...
            </div>
          )}
        </div>

        <div className="px-5 py-2.5 border-t border-slate-200 bg-white flex flex-wrap gap-1.5">
          {QUICK_PROMPTS[language].map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => void sendMessage(prompt)}
              className="text-xs px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors truncate max-w-full"
            >
              {prompt}
            </button>
          ))}
        </div>

        {error && (
          <div className="px-5 py-2 bg-red-50 border-t border-red-200 text-xs text-red-800">
            {error}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage(input);
          }}
          className="p-4 border-t border-slate-200 flex items-center gap-2 bg-white"
        >
          <button
            type="button"
            onClick={handleVoiceInput}
            aria-label={listening ? 'Listening...' : 'Speak message'}
            className={`p-2.5 rounded-lg border transition-colors shrink-0 ${
              listening
                ? 'bg-red-50 border-red-300 text-red-700'
                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <label htmlFor="ai-assistant-input" className="sr-only">
            Ask HomeHeal Assistant
          </label>
          <input
            id="ai-assistant-input"
            type="text"
            dir={language === 'ur' ? 'rtl' : 'ltr'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              language === 'ur'
                ? 'سروس، اسٹیٹس یا ڈرافٹ کے لیے لکھیں...'
                : language === 'roman_ur'
                  ? 'Service, status ya draft ke liye likhein...'
                  : 'Ask about services, request status, or prepare a draft...'
            }
            className="flex-1 px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 focus:bg-white"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            aria-label="Send to Assistant"
            className="px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-1.5 shrink-0"
          >
            <Send className="w-4 h-4" aria-hidden="true" />
            <span>Ask</span>
          </button>
        </form>
      </div>
    </div>
  );
}

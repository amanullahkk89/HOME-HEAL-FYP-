import 'package:flutter/material.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:speech_to_text/speech_to_text.dart';
import '../models/models.dart';
import '../services/api_client.dart';

class AiAssistantSheet extends StatefulWidget {
  final HomeHealApiClient apiClient;
  final String token;
  final String initialLanguage;
  final ValueChanged<AssistantDraft> onApplyDraft;

  const AiAssistantSheet({
    super.key,
    required this.apiClient,
    required this.token,
    required this.initialLanguage,
    required this.onApplyDraft,
  });

  @override
  State<AiAssistantSheet> createState() => _AiAssistantSheetState();
}

class _AiAssistantSheetState extends State<AiAssistantSheet> {
  late String _language;
  final TextEditingController _controller = TextEditingController();
  final SpeechToText _speech = SpeechToText();
  final FlutterTts _tts = FlutterTts();
  final List<Map<String, dynamic>> _turns = [];
  bool _loading = false;
  bool _listening = false;

  @override
  void initState() {
    super.initState();
    _language = widget.initialLanguage;
    _turns.add({
      'role': 'assistant',
      'text': 'Hello! Ask me about East-City Hospital approved nursing services, check your active request status, or prepare an editable visit draft in English, Urdu, or Roman Urdu.',
      'draft': null,
    });
  }

  Future<void> _send(String message) async {
    final trimmed = message.trim();
    if (trimmed.isEmpty || _loading) return;

    setState(() {
      _turns.add({'role': 'user', 'text': trimmed, 'draft': null});
      _loading = true;
      _controller.clear();
    });

    try {
      final history = _turns
          .take(6)
          .map((t) => {'role': t['role'].toString(), 'text': t['text'].toString()})
          .toList();
      final reply = await widget.apiClient.askAiAssistant(
        token: widget.token,
        message: trimmed,
        language: _language,
        history: history,
      );
      final draftJson = reply['draft'] as Map<String, dynamic>?;
      setState(() {
        _turns.add({
          'role': 'assistant',
          'text': reply['replyText']?.toString() ?? '',
          'draft': draftJson != null ? AssistantDraft.fromJson(draftJson) : null,
        });
      });
    } catch (err) {
      setState(() {
        _turns.add({
          'role': 'assistant',
          'text': 'Assistant temporarily unavailable: $err',
          'draft': null,
        });
      });
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _toggleSpeechInput() async {
    if (_listening) {
      await _speech.stop();
      setState(() => _listening = false);
      return;
    }
    final available = await _speech.initialize();
    if (!available) return;
    setState(() => _listening = true);
    await _speech.listen(
      localeId: _language == 'ur' ? 'ur_PK' : 'en_US',
      onResult: (result) {
        if (result.finalResult) {
          setState(() {
            _controller.text = result.recognizedWords;
            _listening = false;
          });
        }
      },
    );
  }

  Future<void> _speak(String text) async {
    await _tts.setLanguage(_language == 'ur' ? 'ur-PK' : 'en-US');
    await _tts.speak(text);
  }

  @override
  void dispose() {
    _controller.dispose();
    _tts.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
        left: 16,
        right: 16,
        top: 16,
      ),
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.78,
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'HomeHeal Bilingual Assistant',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                ),
                DropdownButton<String>(
                  value: _language,
                  items: const [
                    DropdownMenuItem(value: 'en', child: Text('English')),
                    DropdownMenuItem(value: 'ur', child: Text('اردو')),
                    DropdownMenuItem(value: 'roman_ur', child: Text('Roman Urdu')),
                  ],
                  onChanged: (val) {
                    if (val != null) setState(() => _language = val);
                  },
                ),
              ],
            ),
            const Divider(),
            Expanded(
              child: ListView.builder(
                itemCount: _turns.length,
                itemBuilder: (context, idx) {
                  final turn = _turns[idx];
                  final isUser = turn['role'] == 'user';
                  final draft = turn['draft'] as AssistantDraft?;
                  return Align(
                    alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
                    child: Container(
                      margin: const EdgeInsets.symmetric(vertical: 6),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: isUser ? const Color(0xFF0F766E) : const Color(0xFFF1F5F9),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            turn['text'].toString(),
                            style: TextStyle(
                              color: isUser ? Colors.white : const Color(0xFF0F172A),
                            ),
                          ),
                          if (!isUser)
                            TextButton.icon(
                              onPressed: () => _speak(turn['text'].toString()),
                              icon: const Icon(Icons.volume_up, size: 16),
                              label: const Text('Listen'),
                            ),
                          if (draft != null)
                            ElevatedButton(
                              onPressed: () {
                                widget.onApplyDraft(draft);
                                Navigator.of(context).pop();
                              },
                              child: const Text('Load Draft (Requires Your Confirmation)'),
                            ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
            if (_loading) const LinearProgressIndicator(),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(
                children: [
                  IconButton(
                    onPressed: _toggleSpeechInput,
                    icon: Icon(_listening ? Icons.mic_off : Icons.mic),
                  ),
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      decoration: const InputDecoration(
                        hintText: 'Ask about services, status, or draft...',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton(
                    onPressed: () => _send(_controller.text),
                    child: const Text('Ask'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

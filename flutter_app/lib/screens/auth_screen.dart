import 'package:flutter/material.dart';
import '../config/app_config.dart';
import '../models/models.dart';
import '../services/api_client.dart';

class AuthScreen extends StatefulWidget {
  final HomeHealApiClient apiClient;
  final void Function(SessionPayload) onAuthenticated;

  const AuthScreen({
    super.key,
    required this.apiClient,
    required this.onAuthenticated,
  });

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _emailCtrl = TextEditingController(text: 'patient.ali@example.com');
  final _passCtrl = TextEditingController(text: AppConfig.demoPasswordHint);
  final _nameCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _addressCtrl = TextEditingController();
  bool _registerMode = false;
  String _role = 'patient';
  bool _busy = false;
  String? _error;

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final session = _registerMode
          ? await widget.apiClient.register(
              email: _emailCtrl.text.trim(),
              password: _passCtrl.text,
              fullName: _nameCtrl.text.trim(),
              phone: _phoneCtrl.text.trim(),
              role: _role,
              defaultAddress: _role == 'patient' ? _addressCtrl.text.trim() : null,
            )
          : await widget.apiClient.login(_emailCtrl.text.trim(), _passCtrl.text);
      widget.onAuthenticated(session);
    } catch (err) {
      setState(() => _error = err.toString().replaceFirst('Exception: ', ''));
    } finally {
      setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('HomeHeal · East-City Hospital')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Smart Home Healthcare Assistance System',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 6),
            const Text('Authorized single-hospital nursing dispatch for East-City Hospital.'),
            const SizedBox(height: 20),
            SegmentedButton<bool>(
              segments: const [
                ButtonSegment(value: false, label: Text('Sign In')),
                ButtonSegment(value: true, label: Text('Register')),
              ],
              selected: {_registerMode},
              onSelectionChanged: (sel) => setState(() => _registerMode = sel.first),
            ),
            const SizedBox(height: 16),
            if (_error != null)
              Container(
                padding: const EdgeInsets.all(12),
                margin: const EdgeInsets.only(bottom: 12),
                decoration: BoxDecoration(
                  color: Colors.red.shade50,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(_error!, style: TextStyle(color: Colors.red.shade900)),
              ),
            if (_registerMode) ...[
              DropdownButtonFormField<String>(
                value: _role,
                decoration: const InputDecoration(labelText: 'Role', border: OutlineInputBorder()),
                items: const [
                  DropdownMenuItem(value: 'patient', child: Text('Patient')),
                  DropdownMenuItem(value: 'nurse', child: Text('Registered Nurse')),
                  DropdownMenuItem(value: 'doctor', child: Text('Hospital Doctor')),
                ],
                onChanged: (v) => setState(() => _role = v ?? 'patient'),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _nameCtrl,
                decoration: const InputDecoration(labelText: 'Full Name', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _phoneCtrl,
                decoration: const InputDecoration(labelText: 'Phone', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 12),
              if (_role == 'patient')
                TextField(
                  controller: _addressCtrl,
                  decoration: const InputDecoration(labelText: 'Home Address', border: OutlineInputBorder()),
                ),
              const SizedBox(height: 12),
            ],
            TextField(
              controller: _emailCtrl,
              decoration: const InputDecoration(labelText: 'Email', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _passCtrl,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Password', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _busy ? null : _submit,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF0F766E),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              child: Text(_busy ? 'Working...' : (_registerMode ? 'Create Account' : 'Sign In')),
            ),
          ],
        ),
      ),
    );
  }
}

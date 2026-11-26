import 'package:flutter/material.dart';
import '../models/models.dart';
import '../services/api_client.dart';

class AdminHomeScreen extends StatefulWidget {
  final HomeHealApiClient apiClient;
  final SessionPayload session;
  final List<ServiceRequest> requests;
  final Future<void> Function() onRefresh;
  final VoidCallback onSignOut;

  const AdminHomeScreen({
    super.key,
    required this.apiClient,
    required this.session,
    required this.requests,
    required this.onRefresh,
    required this.onSignOut,
  });

  @override
  State<AdminHomeScreen> createState() => _AdminHomeScreenState();
}

class _AdminHomeScreenState extends State<AdminHomeScreen> {
  List<CredentialDoc> _credentials = [];

  @override
  void initState() {
    super.initState();
    _loadStaff();
  }

  Future<void> _loadStaff() async {
    final data = await widget.apiClient.fetchAdminStaff(widget.session.token);
    final rawCreds = (data['credentials'] as List<dynamic>? ?? []);
    if (mounted) {
      setState(() {
        _credentials = rawCreds
            .map((e) => CredentialDoc.fromJson(e as Map<String, dynamic>))
            .toList();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('HomeHeal Admin Console'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: () async {
            await widget.onRefresh();
            await _loadStaff();
          }),
          IconButton(icon: const Icon(Icons.logout), onPressed: widget.onSignOut),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text('Staff Credential Verification Queue', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          ..._credentials.map((cred) => Card(
                child: ListTile(
                  title: Text('${cred.userName ?? ''} (${cred.role ?? ''})'),
                  subtitle: Text('${cred.documentType} · Status: ${cred.reviewStatus}'),
                  trailing: cred.reviewStatus == 'pending'
                      ? Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            TextButton(
                              onPressed: () async {
                                await widget.apiClient.reviewCredential(
                                  widget.session.token,
                                  cred.id,
                                  'approved',
                                  'Approved via East-City Mobile Admin.',
                                );
                                await _loadStaff();
                              },
                              child: const Text('Approve'),
                            ),
                            TextButton(
                              onPressed: () async {
                                await widget.apiClient.reviewCredential(
                                  widget.session.token,
                                  cred.id,
                                  'rejected',
                                  'Rejected via East-City Mobile Admin.',
                                );
                                await _loadStaff();
                              },
                              child: const Text('Reject'),
                            ),
                          ],
                        )
                      : null,
                ),
              )),
          const SizedBox(height: 16),
          const Text('Hospital Request Monitor', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          ...widget.requests.map((r) => ListTile(
                title: Text('${r.requestCode} · ${r.serviceName}'),
                subtitle: Text('${r.patientName} · Nurse: ${r.assignedNurseName ?? 'Unassigned'} · ${r.status}'),
              )),
        ],
      ),
    );
  }
}

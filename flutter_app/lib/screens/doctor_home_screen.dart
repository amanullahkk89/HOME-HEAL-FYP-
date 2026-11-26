import 'package:flutter/material.dart';
import '../models/models.dart';
import '../services/api_client.dart';

class DoctorHomeScreen extends StatefulWidget {
  final HomeHealApiClient apiClient;
  final SessionPayload session;
  final List<ServiceRequest> requests;
  final List<AppNotification> notifications;
  final ValueChanged<SessionPayload> onSessionUpdated;
  final Future<void> Function() onRefresh;
  final VoidCallback onSignOut;

  const DoctorHomeScreen({
    super.key,
    required this.apiClient,
    required this.session,
    required this.requests,
    required this.notifications,
    required this.onSessionUpdated,
    required this.onRefresh,
    required this.onSignOut,
  });

  @override
  State<DoctorHomeScreen> createState() => _DoctorHomeScreenState();
}

class _DoctorHomeScreenState extends State<DoctorHomeScreen> {
  late String _status;

  @override
  void initState() {
    super.initState();
    _status = widget.session.profile['availabilityStatus']?.toString() ?? 'on_duty';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('HomeHeal Doctor Coordination'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: widget.onRefresh),
          IconButton(icon: const Icon(Icons.logout), onPressed: widget.onSignOut),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(widget.session.user.fullName, style: const TextStyle(fontWeight: FontWeight.w700)),
                  Text('PMDC: ${widget.session.profile['pmdcLicense'] ?? 'N/A'}'),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    value: _status,
                    decoration: const InputDecoration(labelText: 'Hospital Coordination Availability', border: OutlineInputBorder()),
                    items: const [
                      DropdownMenuItem(value: 'on_duty', child: Text('On Duty')),
                      DropdownMenuItem(value: 'on_call', child: Text('On Call')),
                      DropdownMenuItem(value: 'off_duty', child: Text('Off Duty')),
                    ],
                    onChanged: (v) async {
                      if (v == null) return;
                      setState(() => _status = v);
                      final updated = await widget.apiClient.updateDoctorProfile(
                        widget.session.token,
                        department: widget.session.profile['department']?.toString() ?? 'Internal Medicine',
                        specialty: widget.session.profile['specialty']?.toString() ?? 'Care Coordination',
                        availabilityStatus: v,
                      );
                      widget.onSessionUpdated(updated);
                    },
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          const Text('Hospital Coordination Notifications', style: TextStyle(fontWeight: FontWeight.w700)),
          ...widget.notifications.take(10).map((n) => ListTile(
                title: Text(n.title),
                subtitle: Text(n.body),
              )),
          const Divider(),
          const Text('De-Identified Nursing Coordination Feed', style: TextStyle(fontWeight: FontWeight.w700)),
          ...widget.requests.map((r) => ListTile(
                title: Text('${r.requestCode} · ${r.serviceName}'),
                subtitle: Text('Nurse: ${r.assignedNurseName ?? 'Pending'} · Status: ${r.status}'),
              )),
        ],
      ),
    );
  }
}

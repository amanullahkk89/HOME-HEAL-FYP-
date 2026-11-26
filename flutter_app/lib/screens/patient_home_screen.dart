import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../models/models.dart';
import '../services/api_client.dart';
import '../services/location_service.dart';
import '../widgets/ai_assistant_sheet.dart';

class PatientHomeScreen extends StatefulWidget {
  final HomeHealApiClient apiClient;
  final SessionPayload session;
  final HospitalSettings hospital;
  final List<ApprovedService> services;
  final List<ServiceRequest> requests;
  final bool isConnected;
  final Future<void> Function() onRefresh;
  final VoidCallback onSignOut;

  const PatientHomeScreen({
    super.key,
    required this.apiClient,
    required this.session,
    required this.hospital,
    required this.services,
    required this.requests,
    required this.isConnected,
    required this.onRefresh,
    required this.onSignOut,
  });

  @override
  State<PatientHomeScreen> createState() => _PatientHomeScreenState();
}

class _PatientHomeScreenState extends State<PatientHomeScreen> {
  final Completer<GoogleMapController> _mapController = Completer();
  int? _selectedServiceId;
  late TextEditingController _addressCtrl;
  final TextEditingController _windowCtrl = TextEditingController(text: '14:00 - 16:00 Today');
  final TextEditingController _notesCtrl = TextEditingController();
  double _lat = 33.7215;
  double _lng = 73.0568;
  bool _locationConsent = false;
  bool _confirmed = false;
  bool _hasLocationPermission = false;
  bool _submitting = false;
  String? _statusMsg;

  @override
  void initState() {
    super.initState();
    _selectedServiceId = widget.services.isNotEmpty ? widget.services.first.id : null;
    _addressCtrl = TextEditingController(
      text: widget.session.profile['defaultAddress']?.toString() ??
          'House 22, Street 9, Sector F-7/2, Islamabad',
    );
    _checkLocationPermission();
  }

  Future<void> _checkLocationPermission() async {
    final granted = await LocationService.ensureLocationPermission();
    if (mounted) setState(() => _hasLocationPermission = granted);
  }

  Future<void> _captureGps() async {
    final pos = await LocationService.getCurrentPositionWithConsent();
    if (pos != null && mounted) {
      setState(() {
        _hasLocationPermission = true;
        _lat = pos.latitude;
        _lng = pos.longitude;
      });
    }
  }

  Future<void> _submitRequest() async {
    if (_selectedServiceId == null || !_locationConsent || !_confirmed) {
      setState(() => _statusMsg = 'Grant Location Consent and tick Confirmation first.');
      return;
    }
    setState(() {
      _submitting = true;
      _statusMsg = null;
    });
    try {
      final created = await widget.apiClient.createRequest(
        token: widget.session.token,
        serviceId: _selectedServiceId!,
        patientAddress: _addressCtrl.text.trim(),
        patientLat: _lat,
        patientLng: _lng,
        preferredTimeWindow: _windowCtrl.text.trim(),
        patientNotes: _notesCtrl.text.trim(),
      );
      setState(() {
        _confirmed = false;
        _statusMsg = 'Submitted ${created.requestCode} (${created.status}).';
      });
      await widget.onRefresh();
    } catch (err) {
      setState(() => _statusMsg = err.toString().replaceFirst('Exception: ', ''));
    } finally {
      setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final activeVisit = widget.requests.where((r) => r.status == 'Pending' || r.isActiveVisit).firstOrNull;
    final markers = <Marker>{
      Marker(
        markerId: const MarkerId('hospital'),
        position: LatLng(widget.hospital.latitude, widget.hospital.longitude),
        infoWindow: InfoWindow(title: widget.hospital.hospitalName),
      ),
      Marker(
        markerId: const MarkerId('patient'),
        position: LatLng(activeVisit?.patientLat ?? _lat, activeVisit?.patientLng ?? _lng),
        infoWindow: const InfoWindow(title: 'Patient Home'),
      ),
      if (activeVisit?.assignedNurseLat != null && activeVisit?.assignedNurseLng != null)
        Marker(
          markerId: const MarkerId('nurse'),
          position: LatLng(activeVisit!.assignedNurseLat!, activeVisit.assignedNurseLng!),
          infoWindow: InfoWindow(title: activeVisit.assignedNurseName ?? 'Assigned Nurse'),
        ),
    };

    return Scaffold(
      appBar: AppBar(
        title: const Text('HomeHeal Patient'),
        actions: [
          Icon(widget.isConnected ? Icons.wifi : Icons.wifi_off, size: 18),
          IconButton(icon: const Icon(Icons.refresh), onPressed: widget.onRefresh),
          IconButton(icon: const Icon(Icons.logout), onPressed: widget.onSignOut),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () {
          showModalBottomSheet(
            context: context,
            isScrollControlled: true,
            builder: (_) => AiAssistantSheet(
              apiClient: widget.apiClient,
              token: widget.session.token,
              initialLanguage: widget.session.user.preferredLanguage,
              onApplyDraft: (draft) {
                setState(() {
                  if (draft.serviceId != null) _selectedServiceId = draft.serviceId;
                  if (draft.preferredTimeWindow.isNotEmpty) _windowCtrl.text = draft.preferredTimeWindow;
                  if (draft.patientNotes.isNotEmpty) _notesCtrl.text = draft.patientNotes;
                  if (draft.patientAddress.isNotEmpty) _addressCtrl.text = draft.patientAddress;
                  _confirmed = false;
                });
              },
            ),
          );
        },
        icon: const Icon(Icons.smart_toy_outlined),
        label: const Text('AI Assistant'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_statusMsg != null)
            Card(
              color: const Color(0xFFF0FDFA),
              child: Padding(padding: const EdgeInsets.all(12), child: Text(_statusMsg!)),
            ),
          if (activeVisit != null) ...[
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${activeVisit.requestCode} · ${activeVisit.status}',
                        style: const TextStyle(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 4),
                    Text(activeVisit.serviceName),
                    Text('Nurse: ${activeVisit.assignedNurseName ?? 'Awaiting acceptance'}'),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
          ],
          SizedBox(
            height: 220,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: GoogleMap(
                initialCameraPosition: CameraPosition(
                  target: LatLng(widget.hospital.latitude, widget.hospital.longitude),
                  zoom: 12.5,
                ),
                myLocationEnabled: _hasLocationPermission,
                markers: markers,
                gestureRecognizers: {
                  Factory<EagerGestureRecognizer>(() => EagerGestureRecognizer()),
                },
                onMapCreated: (c) {
                  if (!_mapController.isCompleted) _mapController.complete(c);
                },
              ),
            ),
          ),
          const SizedBox(height: 16),
          const Text('Request Approved Nursing Visit', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          DropdownButtonFormField<int>(
            value: _selectedServiceId,
            decoration: const InputDecoration(labelText: 'Approved Service', border: OutlineInputBorder()),
            items: widget.services
                .map((s) => DropdownMenuItem(value: s.id, child: Text(s.name)))
                .toList(),
            onChanged: (v) => setState(() => _selectedServiceId = v),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _addressCtrl,
            decoration: const InputDecoration(labelText: 'Home Address', border: OutlineInputBorder()),
          ),
          TextButton.icon(
            onPressed: _captureGps,
            icon: const Icon(Icons.my_location),
            label: Text('Use Current GPS (${_lat.toStringAsFixed(4)}, ${_lng.toStringAsFixed(4)})'),
          ),
          TextField(
            controller: _windowCtrl,
            decoration: const InputDecoration(labelText: 'Preferred Time Window', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _notesCtrl,
            decoration: const InputDecoration(labelText: 'Visit Notes', border: OutlineInputBorder()),
          ),
          CheckboxListTile(
            value: _locationConsent,
            onChanged: (v) => setState(() => _locationConsent = v ?? false),
            title: const Text('I explicitly consent to share my home location with East-City Hospital & assigned nurse.'),
          ),
          CheckboxListTile(
            value: _confirmed,
            onChanged: (v) => setState(() => _confirmed = v ?? false),
            title: const Text('I have reviewed the details above and confirm submission.'),
          ),
          ElevatedButton(
            onPressed: _submitting ? null : _submitRequest,
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF0F766E),
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
            child: Text(_submitting ? 'Submitting...' : 'Confirm & Submit Request'),
          ),
        ],
      ),
    );
  }
}

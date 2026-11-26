import 'dart:convert';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../models/models.dart';
import '../services/api_client.dart';
import '../services/firebase_service.dart';
import '../services/location_service.dart';

class NurseHomeScreen extends StatefulWidget {
  final HomeHealApiClient apiClient;
  final SessionPayload session;
  final HospitalSettings hospital;
  final List<ServiceRequest> requests;
  final List<NurseOffer> offers;
  final Future<void> Function() onRefresh;
  final ValueChanged<SessionPayload> onSessionUpdated;
  final VoidCallback onSignOut;

  const NurseHomeScreen({
    super.key,
    required this.apiClient,
    required this.session,
    required this.hospital,
    required this.requests,
    required this.offers,
    required this.onRefresh,
    required this.onSessionUpdated,
    required this.onSignOut,
  });

  @override
  State<NurseHomeScreen> createState() => _NurseHomeScreenState();
}

class _NurseHomeScreenState extends State<NurseHomeScreen> {
  String? _notice;

  Future<void> _syncGps() async {
    final pos = await LocationService.getCurrentPositionWithConsent();
    if (pos == null) return;
    await widget.apiClient.publishNurseLocation(widget.session.token, pos.latitude, pos.longitude);
    setState(() => _notice = 'GPS synced (${pos.latitude.toStringAsFixed(4)}, ${pos.longitude.toStringAsFixed(4)})');
    await widget.onRefresh();
  }

  Future<void> _uploadCredential() async {
    final result = await FilePicker.platform.pickFiles(withData: true);
    if (result == null || result.files.isEmpty) return;
    final file = result.files.first;
    if (file.bytes == null) return;

    await FirebaseService.uploadPrivateCredentialBytes(
      userId: widget.session.user.id,
      filename: file.name,
      bytes: file.bytes!,
    );

    final updated = await widget.apiClient.uploadCredential(
      token: widget.session.token,
      documentType: 'PNC Registered Nurse License',
      originalFilename: file.name,
      mimeType: file.extension == 'pdf' ? 'application/pdf' : 'image/png',
      base64Content: base64Encode(file.bytes!),
    );
    widget.onSessionUpdated(updated);
    setState(() => _notice = 'Credential uploaded for Hospital Admin review.');
  }

  @override
  Widget build(BuildContext context) {
    final isApproved = widget.session.profile['verificationStatus'] == 'approved';
    final isOnline = widget.session.profile['isOnline'] == true;
    final isAvailable = widget.session.profile['isAvailable'] == true;
    final hasConsent = widget.session.profile['locationConsentGranted'] == true;

    final pendingOffers = widget.offers
        .where((o) => o.offerStatus == 'offered' && o.requestStatus == 'Pending')
        .toList();
    final activeVisit = widget.requests.where((r) => r.isActiveVisit).firstOrNull;

    return Scaffold(
      appBar: AppBar(
        title: const Text('HomeHeal Nurse'),
        actions: [
          IconButton(icon: const Icon(Icons.my_location), onPressed: hasConsent ? _syncGps : null),
          IconButton(icon: const Icon(Icons.refresh), onPressed: widget.onRefresh),
          IconButton(icon: const Icon(Icons.logout), onPressed: widget.onSignOut),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_notice != null)
            Card(child: Padding(padding: const EdgeInsets.all(12), child: Text(_notice!))),
          Card(
            child: Column(
              children: [
                SwitchListTile(
                  value: isOnline,
                  title: const Text('Online Status'),
                  onChanged: isApproved
                      ? (v) async {
                          final updated = await widget.apiClient.updateNurseStatus(
                            widget.session.token,
                            isOnline: v,
                          );
                          widget.onSessionUpdated(updated);
                        }
                      : null,
                ),
                SwitchListTile(
                  value: isAvailable,
                  title: const Text('Available for Offers'),
                  onChanged: isApproved
                      ? (v) async {
                          final updated = await widget.apiClient.updateNurseStatus(
                            widget.session.token,
                            isAvailable: v,
                          );
                          widget.onSessionUpdated(updated);
                        }
                      : null,
                ),
                SwitchListTile(
                  value: hasConsent,
                  title: const Text('Consent-Based GPS Sharing'),
                  onChanged: (v) async {
                    final fcm = await FirebaseService.requestFcmToken();
                    final updated = await widget.apiClient.updateNurseStatus(
                      widget.session.token,
                      locationConsentGranted: v,
                      fcmToken: fcm,
                    );
                    widget.onSessionUpdated(updated);
                  },
                ),
                ListTile(
                  title: Text('Verification: ${widget.session.profile['verificationStatus'] ?? 'pending'}'),
                  trailing: TextButton.icon(
                    onPressed: _uploadCredential,
                    icon: const Icon(Icons.upload_file),
                    label: const Text('Upload License'),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          if (activeVisit != null) ...[
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Active Visit: ${activeVisit.requestCode} (${activeVisit.status})',
                        style: const TextStyle(fontWeight: FontWeight.w700)),
                    Text('${activeVisit.serviceName} · ${activeVisit.patientAddress}'),
                    const SizedBox(height: 10),
                    SizedBox(
                      height: 190,
                      child: GoogleMap(
                        initialCameraPosition: CameraPosition(
                          target: LatLng(activeVisit.patientLat, activeVisit.patientLng),
                          zoom: 13,
                        ),
                        markers: {
                          Marker(
                            markerId: const MarkerId('dest'),
                            position: LatLng(activeVisit.patientLat, activeVisit.patientLng),
                            infoWindow: InfoWindow(title: activeVisit.patientName),
                          ),
                        },
                        gestureRecognizers: {
                          Factory<EagerGestureRecognizer>(() => EagerGestureRecognizer()),
                        },
                      ),
                    ),
                    const SizedBox(height: 10),
                    if (activeVisit.status == 'Accepted')
                      ElevatedButton(
                        onPressed: () async {
                          await widget.apiClient.updateRequestStatus(
                              widget.session.token, activeVisit.id, 'En Route');
                          await widget.onRefresh();
                        },
                        child: const Text('Mark En Route'),
                      ),
                    if (activeVisit.status == 'En Route')
                      ElevatedButton(
                        onPressed: () async {
                          await widget.apiClient.updateRequestStatus(
                              widget.session.token, activeVisit.id, 'Arrived');
                          await widget.onRefresh();
                        },
                        child: const Text('Mark Arrived'),
                      ),
                    if (activeVisit.status == 'Arrived')
                      ElevatedButton(
                        onPressed: () async {
                          await widget.apiClient.updateRequestStatus(
                              widget.session.token, activeVisit.id, 'Completed');
                          await widget.onRefresh();
                        },
                        child: const Text('Complete Visit'),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],
          const Text('Eligible Ranked Visit Offers', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          ...pendingOffers.map((offer) => Card(
                child: ListTile(
                  title: Text('${offer.serviceName} (${offer.haversineDistanceKm.toStringAsFixed(2)} km)'),
                  subtitle: Text('${offer.patientAddress} · Rank #${offer.rankOrder}'),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      TextButton(
                        onPressed: () async {
                          await widget.apiClient.declineOffer(widget.session.token, offer.requestId);
                          await widget.onRefresh();
                        },
                        child: const Text('Decline'),
                      ),
                      ElevatedButton(
                        onPressed: activeVisit == null
                            ? () async {
                                await widget.apiClient.acceptRequest(widget.session.token, offer.requestId);
                                await widget.onRefresh();
                              }
                            : null,
                        child: const Text('Accept'),
                      ),
                    ],
                  ),
                ),
              )),
        ],
      ),
    );
  }
}

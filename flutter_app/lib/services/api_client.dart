import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/app_config.dart';
import '../models/models.dart';

class HomeHealApiClient {
  final String baseUrl;

  HomeHealApiClient({this.baseUrl = AppConfig.apiBaseUrl});

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    String? token,
    Map<String, dynamic>? body,
  }) async {
    final uri = Uri.parse('$baseUrl$path');
    final headers = <String, String>{
      'Content-Type': 'application/json',
      if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
    };

    late http.Response response;
    if (method == 'GET') {
      response = await http.get(uri, headers: headers);
    } else if (method == 'POST') {
      response = await http.post(uri, headers: headers, body: jsonEncode(body ?? {}));
    } else if (method == 'PATCH') {
      response = await http.patch(uri, headers: headers, body: jsonEncode(body ?? {}));
    } else {
      throw UnsupportedError('Unsupported HTTP method $method');
    }

    final decoded = jsonDecode(response.body.isEmpty ? '{}' : response.body) as Map<String, dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(decoded['error']?.toString() ?? 'Request failed (${response.statusCode})');
    }
    return decoded;
  }

  Future<HospitalSettings> fetchHospital() async =>
      HospitalSettings.fromJson(await _request('GET', '/api/hospital'));

  Future<List<ApprovedService>> fetchApprovedServices() async {
    final data = await _request('GET', '/api/services');
    return (data['services'] as List<dynamic>)
        .map((e) => ApprovedService.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<SessionPayload> login(String email, String password) async {
    final data = await _request('POST', '/api/auth/login', body: {
      'email': email,
      'password': password,
    });
    return SessionPayload.fromJson(data);
  }

  Future<SessionPayload> register({
    required String email,
    required String password,
    required String fullName,
    required String phone,
    required String role,
    String preferredLanguage = 'en',
    String? defaultAddress,
    String? licenseNumber,
    String? specialization,
  }) async {
    final data = await _request('POST', '/api/auth/register', body: {
      'email': email,
      'password': password,
      'fullName': fullName,
      'phone': phone,
      'role': role,
      'preferredLanguage': preferredLanguage,
      if (defaultAddress != null) 'defaultAddress': defaultAddress,
      if (licenseNumber != null) 'licenseNumber': licenseNumber,
      if (specialization != null) 'specialization': specialization,
    });
    return SessionPayload.fromJson(data);
  }

  Future<SessionPayload> fetchMe(String token) async {
    final data = await _request('GET', '/api/auth/me', token: token);
    return SessionPayload.fromJson(data, token);
  }

  Future<({List<ServiceRequest> requests, List<NurseOffer> offers})> fetchRequests(String token) async {
    final data = await _request('GET', '/api/requests', token: token);
    final reqs = (data['requests'] as List<dynamic>)
        .map((e) => ServiceRequest.fromJson(e as Map<String, dynamic>))
        .toList();
    final offs = (data['offers'] as List<dynamic>? ?? [])
        .map((e) => NurseOffer.fromJson(e as Map<String, dynamic>))
        .toList();
    return (requests: reqs, offers: offs);
  }

  Future<ServiceRequest> createRequest({
    required String token,
    required int serviceId,
    required String patientAddress,
    required double patientLat,
    required double patientLng,
    required String preferredTimeWindow,
    required String patientNotes,
    bool assistantDraftUsed = false,
  }) async {
    final data = await _request('POST', '/api/requests', token: token, body: {
      'serviceId': serviceId,
      'patientAddress': patientAddress,
      'patientLat': patientLat,
      'patientLng': patientLng,
      'patientLocationConsent': true,
      'explicitConfirmation': true,
      'preferredTimeWindow': preferredTimeWindow,
      'patientNotes': patientNotes,
      'assistantDraftUsed': assistantDraftUsed,
    });
    return ServiceRequest.fromJson(data['request'] as Map<String, dynamic>);
  }

  Future<SessionPayload> updateNurseStatus(
    String token, {
    bool? isAvailable,
    bool? isOnline,
    bool? locationConsentGranted,
    double? currentLat,
    double? currentLng,
    String? fcmToken,
  }) async {
    final data = await _request('PATCH', '/api/nurse/status', token: token, body: {
      if (isAvailable != null) 'isAvailable': isAvailable,
      if (isOnline != null) 'isOnline': isOnline,
      if (locationConsentGranted != null) 'locationConsentGranted': locationConsentGranted,
      if (currentLat != null) 'currentLat': currentLat,
      if (currentLng != null) 'currentLng': currentLng,
      if (fcmToken != null) 'fcmToken': fcmToken,
    });
    return SessionPayload.fromJson(data, token);
  }

  Future<void> publishNurseLocation(String token, double lat, double lng) async {
    await _request('POST', '/api/nurse/location', token: token, body: {'lat': lat, 'lng': lng});
  }

  Future<ServiceRequest> acceptRequest(String token, int requestId) async {
    final data = await _request('POST', '/api/requests/$requestId/accept', token: token);
    return ServiceRequest.fromJson(data['request'] as Map<String, dynamic>);
  }

  Future<void> declineOffer(String token, int requestId) async {
    await _request('POST', '/api/requests/$requestId/decline', token: token);
  }

  Future<ServiceRequest> updateRequestStatus(String token, int requestId, String nextStatus) async {
    final data = await _request('PATCH', '/api/requests/$requestId/status', token: token, body: {
      'status': nextStatus,
    });
    return ServiceRequest.fromJson(data['request'] as Map<String, dynamic>);
  }

  Future<List<ChatMessage>> fetchMessages(String token, int requestId) async {
    final data = await _request('GET', '/api/requests/$requestId/messages', token: token);
    return (data['messages'] as List<dynamic>)
        .map((e) => ChatMessage.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<ChatMessage> sendMessage(
    String token,
    int requestId,
    String body,
    String clientMsgId,
  ) async {
    final data = await _request('POST', '/api/requests/$requestId/messages', token: token, body: {
      'body': body,
      'clientMsgId': clientMsgId,
    });
    return ChatMessage.fromJson(data['message'] as Map<String, dynamic>);
  }

  Future<SessionPayload> uploadCredential({
    required String token,
    required String documentType,
    required String originalFilename,
    required String mimeType,
    required String base64Content,
  }) async {
    final data = await _request('POST', '/api/credentials/upload', token: token, body: {
      'documentType': documentType,
      'originalFilename': originalFilename,
      'mimeType': mimeType,
      'base64Content': base64Content,
    });
    return SessionPayload.fromJson(data['session'] as Map<String, dynamic>, token);
  }

  Future<List<AppNotification>> fetchNotifications(String token) async {
    final data = await _request('GET', '/api/notifications', token: token);
    return (data['notifications'] as List<dynamic>)
        .map((e) => AppNotification.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<Map<String, dynamic>> askAiAssistant({
    required String token,
    required String message,
    required String language,
    required List<Map<String, String>> history,
  }) async {
    return _request('POST', '/api/ai/assist', token: token, body: {
      'message': message,
      'language': language,
      'history': history,
    });
  }

  Future<Map<String, dynamic>> fetchAdminStaff(String token) async =>
      _request('GET', '/api/admin/staff', token: token);

  Future<void> reviewCredential(
    String token,
    int credId,
    String decision,
    String notes,
  ) async {
    await _request('PATCH', '/api/admin/credentials/$credId/review', token: token, body: {
      'decision': decision,
      'reviewNotes': notes,
    });
  }

  Future<SessionPayload> updateDoctorProfile(
    String token, {
    required String department,
    required String specialty,
    required String availabilityStatus,
  }) async {
    final data = await _request('PATCH', '/api/doctor/profile', token: token, body: {
      'department': department,
      'specialty': specialty,
      'availabilityStatus': availabilityStatus,
    });
    return SessionPayload.fromJson(data, token);
  }
}

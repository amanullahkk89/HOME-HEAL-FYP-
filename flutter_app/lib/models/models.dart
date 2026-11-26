class AuthUser {
  final int id;
  final String email;
  final String fullName;
  final String phone;
  final String role;
  final String preferredLanguage;

  AuthUser({
    required this.id,
    required this.email,
    required this.fullName,
    required this.phone,
    required this.role,
    required this.preferredLanguage,
  });

  factory AuthUser.fromJson(Map<String, dynamic> json) => AuthUser(
        id: (json['id'] as num).toInt(),
        email: json['email'] as String? ?? '',
        fullName: json['fullName'] as String? ?? '',
        phone: json['phone'] as String? ?? '',
        role: json['role'] as String? ?? 'patient',
        preferredLanguage: json['preferredLanguage'] as String? ?? 'en',
      );
}

class SessionPayload {
  final String token;
  final AuthUser user;
  final Map<String, dynamic> profile;
  final List<CredentialDoc> credentials;

  SessionPayload({
    required this.token,
    required this.user,
    required this.profile,
    required this.credentials,
  });

  factory SessionPayload.fromJson(Map<String, dynamic> json, [String? existingToken]) {
    final rawCreds = (json['credentials'] as List<dynamic>? ?? []);
    return SessionPayload(
      token: json['token'] as String? ?? existingToken ?? '',
      user: AuthUser.fromJson(json['user'] as Map<String, dynamic>),
      profile: (json['profile'] as Map<String, dynamic>? ?? {}),
      credentials: rawCreds
          .map((e) => CredentialDoc.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}

class CredentialDoc {
  final int id;
  final String? userName;
  final String? role;
  final String documentType;
  final String storageProvider;
  final String originalFilename;
  final String mimeType;
  final String reviewStatus;
  final String reviewNotes;

  CredentialDoc({
    required this.id,
    this.userName,
    this.role,
    required this.documentType,
    required this.storageProvider,
    required this.originalFilename,
    required this.mimeType,
    required this.reviewStatus,
    required this.reviewNotes,
  });

  factory CredentialDoc.fromJson(Map<String, dynamic> json) => CredentialDoc(
        id: (json['id'] as num).toInt(),
        userName: json['userName'] as String?,
        role: json['role'] as String?,
        documentType: json['documentType'] as String? ?? '',
        storageProvider: json['storageProvider'] as String? ?? '',
        originalFilename: json['originalFilename'] as String? ?? '',
        mimeType: json['mimeType'] as String? ?? '',
        reviewStatus: json['reviewStatus'] as String? ?? 'pending',
        reviewNotes: json['reviewNotes'] as String? ?? '',
      );
}

class HospitalSettings {
  final String hospitalName;
  final String address;
  final String city;
  final String phone;
  final double latitude;
  final double longitude;
  final double serviceRadiusKm;
  final String operatingHours;
  final String emergencyNotice;

  HospitalSettings({
    required this.hospitalName,
    required this.address,
    required this.city,
    required this.phone,
    required this.latitude,
    required this.longitude,
    required this.serviceRadiusKm,
    required this.operatingHours,
    required this.emergencyNotice,
  });

  factory HospitalSettings.fromJson(Map<String, dynamic> json) => HospitalSettings(
        hospitalName: json['hospitalName'] as String? ?? 'East-City Hospital',
        address: json['address'] as String? ?? '',
        city: json['city'] as String? ?? 'Islamabad',
        phone: json['phone'] as String? ?? '',
        latitude: (json['latitude'] as num?)?.toDouble() ?? 33.7138,
        longitude: (json['longitude'] as num?)?.toDouble() ?? 73.0501,
        serviceRadiusKm: (json['serviceRadiusKm'] as num?)?.toDouble() ?? 18,
        operatingHours: json['operatingHours'] as String? ?? '07:00 - 22:00',
        emergencyNotice: json['emergencyNotice'] as String? ?? '',
      );
}

class ApprovedService {
  final int id;
  final String code;
  final String name;
  final String nameUr;
  final String category;
  final String description;
  final int estimatedDurationMins;
  final String preparationNotes;
  final bool isActive;

  ApprovedService({
    required this.id,
    required this.code,
    required this.name,
    required this.nameUr,
    required this.category,
    required this.description,
    required this.estimatedDurationMins,
    required this.preparationNotes,
    required this.isActive,
  });

  factory ApprovedService.fromJson(Map<String, dynamic> json) => ApprovedService(
        id: (json['id'] as num).toInt(),
        code: json['code'] as String? ?? '',
        name: json['name'] as String? ?? '',
        nameUr: json['nameUr'] as String? ?? '',
        category: json['category'] as String? ?? '',
        description: json['description'] as String? ?? '',
        estimatedDurationMins: (json['estimatedDurationMins'] as num?)?.toInt() ?? 30,
        preparationNotes: json['preparationNotes'] as String? ?? '',
        isActive: json['isActive'] as bool? ?? true,
      );
}

class ServiceRequest {
  final int id;
  final String requestCode;
  final int patientId;
  final String patientName;
  final int serviceId;
  final String serviceName;
  final int? assignedNurseId;
  final String? assignedNurseName;
  final double? assignedNurseLat;
  final double? assignedNurseLng;
  final String status;
  final String patientAddress;
  final double patientLat;
  final double patientLng;
  final String preferredTimeWindow;
  final String patientNotes;

  ServiceRequest({
    required this.id,
    required this.requestCode,
    required this.patientId,
    required this.patientName,
    required this.serviceId,
    required this.serviceName,
    this.assignedNurseId,
    this.assignedNurseName,
    this.assignedNurseLat,
    this.assignedNurseLng,
    required this.status,
    required this.patientAddress,
    required this.patientLat,
    required this.patientLng,
    required this.preferredTimeWindow,
    required this.patientNotes,
  });

  bool get isActiveVisit =>
      status == 'Accepted' || status == 'En Route' || status == 'Arrived';

  factory ServiceRequest.fromJson(Map<String, dynamic> json) => ServiceRequest(
        id: (json['id'] as num).toInt(),
        requestCode: json['requestCode'] as String? ?? '',
        patientId: (json['patientId'] as num).toInt(),
        patientName: json['patientName'] as String? ?? '',
        serviceId: (json['serviceId'] as num).toInt(),
        serviceName: json['serviceName'] as String? ?? '',
        assignedNurseId: (json['assignedNurseId'] as num?)?.toInt(),
        assignedNurseName: json['assignedNurseName'] as String?,
        assignedNurseLat: (json['assignedNurseLat'] as num?)?.toDouble(),
        assignedNurseLng: (json['assignedNurseLng'] as num?)?.toDouble(),
        status: json['status'] as String? ?? 'Pending',
        patientAddress: json['patientAddress'] as String? ?? '',
        patientLat: (json['patientLat'] as num).toDouble(),
        patientLng: (json['patientLng'] as num).toDouble(),
        preferredTimeWindow: json['preferredTimeWindow'] as String? ?? '',
        patientNotes: json['patientNotes'] as String? ?? '',
      );
}

class NurseOffer {
  final int id;
  final int requestId;
  final String requestCode;
  final String serviceName;
  final String patientAddress;
  final String preferredTimeWindow;
  final double haversineDistanceKm;
  final int rankOrder;
  final String offerStatus;
  final String requestStatus;

  NurseOffer({
    required this.id,
    required this.requestId,
    required this.requestCode,
    required this.serviceName,
    required this.patientAddress,
    required this.preferredTimeWindow,
    required this.haversineDistanceKm,
    required this.rankOrder,
    required this.offerStatus,
    required this.requestStatus,
  });

  factory NurseOffer.fromJson(Map<String, dynamic> json) => NurseOffer(
        id: (json['id'] as num).toInt(),
        requestId: (json['requestId'] as num).toInt(),
        requestCode: json['requestCode'] as String? ?? '',
        serviceName: json['serviceName'] as String? ?? '',
        patientAddress: json['patientAddress'] as String? ?? '',
        preferredTimeWindow: json['preferredTimeWindow'] as String? ?? '',
        haversineDistanceKm: (json['haversineDistanceKm'] as num).toDouble(),
        rankOrder: (json['rankOrder'] as num).toInt(),
        offerStatus: json['offerStatus'] as String? ?? 'offered',
        requestStatus: json['requestStatus'] as String? ?? 'Pending',
      );
}

class ChatMessage {
  final int id;
  final int requestId;
  final int senderId;
  final String senderName;
  final String senderRole;
  final String body;
  final String createdAt;

  ChatMessage({
    required this.id,
    required this.requestId,
    required this.senderId,
    required this.senderName,
    required this.senderRole,
    required this.body,
    required this.createdAt,
  });

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
        id: (json['id'] as num).toInt(),
        requestId: (json['requestId'] as num).toInt(),
        senderId: (json['senderId'] as num).toInt(),
        senderName: json['senderName'] as String? ?? '',
        senderRole: json['senderRole'] as String? ?? '',
        body: json['body'] as String? ?? '',
        createdAt: json['createdAt'] as String? ?? '',
      );
}

class AppNotification {
  final int id;
  final String title;
  final String body;
  final bool isRead;

  AppNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.isRead,
  });

  factory AppNotification.fromJson(Map<String, dynamic> json) => AppNotification(
        id: (json['id'] as num).toInt(),
        title: json['title'] as String? ?? '',
        body: json['body'] as String? ?? '',
        isRead: json['isRead'] as bool? ?? false,
      );
}

class AssistantDraft {
  final int? serviceId;
  final String? serviceCode;
  final String preferredTimeWindow;
  final String patientNotes;
  final String patientAddress;

  AssistantDraft({
    this.serviceId,
    this.serviceCode,
    required this.preferredTimeWindow,
    required this.patientNotes,
    required this.patientAddress,
  });

  factory AssistantDraft.fromJson(Map<String, dynamic> json) => AssistantDraft(
        serviceId: (json['serviceId'] as num?)?.toInt(),
        serviceCode: json['serviceCode'] as String?,
        preferredTimeWindow: json['preferredTimeWindow'] as String? ?? '',
        patientNotes: json['patientNotes'] as String? ?? '',
        patientAddress: json['patientAddress'] as String? ?? '',
      );
}

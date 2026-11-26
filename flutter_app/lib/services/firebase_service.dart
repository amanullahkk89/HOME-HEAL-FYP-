import 'dart:typed_data';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:firebase_storage/firebase_storage.dart';

class FirebaseService {
  static bool _initialized = false;

  static Future<void> initializeIfConfigured() async {
    if (_initialized) return;
    try {
      await Firebase.initializeApp();
      _initialized = true;
    } catch (_) {
      // Allows running against local Node server vault even before google-services.json is attached.
    }
  }

  static Future<String?> requestFcmToken() async {
    if (!_initialized) return null;
    try {
      await FirebaseMessaging.instance.requestPermission();
      return await FirebaseMessaging.instance.getToken();
    } catch (_) {
      return null;
    }
  }

  static Future<String?> uploadPrivateCredentialBytes({
    required int userId,
    required String filename,
    required Uint8List bytes,
  }) async {
    if (!_initialized) return null;
    final ref = FirebaseStorage.instance.ref('credentials/$userId/${DateTime.now().millisecondsSinceEpoch}_$filename');
    await ref.putData(bytes);
    return ref.fullPath;
  }
}

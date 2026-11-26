import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import '../config/app_config.dart';

class SocketService extends ChangeNotifier {
  io.Socket? _socket;
  bool connected = false;

  void connect({
    required String token,
    required VoidCallback onReconnectSync,
    required void Function(Map<String, dynamic>) onRequestUpdated,
    required void Function(Map<String, dynamic>) onMessageNew,
    required void Function(Map<String, dynamic>) onNotificationNew,
    required void Function(Map<String, dynamic>) onNurseLocation,
    required VoidCallback onOfferChanged,
  }) {
    disconnect();
    bool wasDisconnected = false;

    final socket = io.io(
      AppConfig.apiBaseUrl,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': token})
          .enableReconnection()
          .build(),
    );
    _socket = socket;

    socket.onConnect((_) {
      connected = true;
      notifyListeners();
      if (wasDisconnected) {
        wasDisconnected = false;
        onReconnectSync();
      }
    });

    socket.onDisconnect((_) {
      connected = false;
      wasDisconnected = true;
      notifyListeners();
    });

    socket.on('request:updated', (data) {
      if (data is Map) onRequestUpdated(Map<String, dynamic>.from(data));
    });
    socket.on('request:created', (_) => onReconnectSync());
    socket.on('offer:new', (_) => onOfferChanged());
    socket.on('offer:superseded', (_) => onOfferChanged());
    socket.on('message:new', (data) {
      if (data is Map) onMessageNew(Map<String, dynamic>.from(data));
    });
    socket.on('notification:new', (data) {
      if (data is Map) onNotificationNew(Map<String, dynamic>.from(data));
    });
    socket.on('nurse:location', (data) {
      if (data is Map) onNurseLocation(Map<String, dynamic>.from(data));
    });
  }

  void joinRequestRoom(int requestId) {
    _socket?.emit('request:join', {'requestId': requestId});
  }

  void disconnect() {
    _socket?.dispose();
    _socket = null;
    connected = false;
  }
}

import 'package:flutter/material.dart';
import 'models/models.dart';
import 'screens/admin_home_screen.dart';
import 'screens/auth_screen.dart';
import 'screens/doctor_home_screen.dart';
import 'screens/nurse_home_screen.dart';
import 'screens/patient_home_screen.dart';
import 'services/api_client.dart';
import 'services/firebase_service.dart';
import 'services/socket_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await FirebaseService.initializeIfConfigured();
  runApp(const HomeHealApp());
}

class HomeHealApp extends StatelessWidget {
  const HomeHealApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'HomeHeal — East-City Hospital',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorSchemeSeed: const Color(0xFF0F766E),
        useMaterial3: true,
      ),
      home: const HomeHealRoot(),
    );
  }
}

class HomeHealRoot extends StatefulWidget {
  const HomeHealRoot({super.key});

  @override
  State<HomeHealRoot> createState() => _HomeHealRootState();
}

class _HomeHealRootState extends State<HomeHealRoot> {
  final HomeHealApiClient _api = HomeHealApiClient();
  final SocketService _socket = SocketService();

  SessionPayload? _session;
  HospitalSettings _hospital = HospitalSettings(
    hospitalName: 'East-City Hospital',
    address: 'Sector F-8, Islamabad',
    city: 'Islamabad',
    phone: '+92-51-5550100',
    latitude: 33.7138,
    longitude: 73.0501,
    serviceRadiusKm: 18,
    operatingHours: '07:00 - 22:00',
    emergencyNotice: '',
  );
  List<ApprovedService> _services = [];
  List<ServiceRequest> _requests = [];
  List<NurseOffer> _offers = [];
  List<AppNotification> _notifications = [];

  @override
  void initState() {
    super.initState();
    _loadPublicBoot();
  }

  Future<void> _loadPublicBoot() async {
    try {
      final hosp = await _api.fetchHospital();
      final svcs = await _api.fetchApprovedServices();
      if (mounted) {
        setState(() {
          _hospital = hosp;
          _services = svcs;
        });
      }
    } catch (_) {}
  }

  Future<void> _refreshAuthenticated() async {
    final s = _session;
    if (s == null) return;
    final me = await _api.fetchMe(s.token);
    final reqBundle = await _api.fetchRequests(s.token);
    final notifs = await _api.fetchNotifications(s.token);
    if (mounted) {
      setState(() {
        _session = me;
        _requests = reqBundle.requests;
        _offers = reqBundle.offers;
        _notifications = notifs;
      });
    }
  }

  void _onAuthenticated(SessionPayload session) {
    setState(() => _session = session);
    _socket.connect(
      token: session.token,
      onReconnectSync: _refreshAuthenticated,
      onRequestUpdated: (_) => _refreshAuthenticated(),
      onMessageNew: (_) {},
      onNotificationNew: (_) => _refreshAuthenticated(),
      onNurseLocation: (_) => _refreshAuthenticated(),
      onOfferChanged: _refreshAuthenticated,
    );
    _refreshAuthenticated();
  }

  void _signOut() {
    _socket.disconnect();
    setState(() {
      _session = null;
      _requests = [];
      _offers = [];
      _notifications = [];
    });
  }

  @override
  void dispose() {
    _socket.disconnect();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final session = _session;
    if (session == null) {
      return AuthScreen(apiClient: _api, onAuthenticated: _onAuthenticated);
    }

    switch (session.user.role) {
      case 'nurse':
        return NurseHomeScreen(
          apiClient: _api,
          session: session,
          hospital: _hospital,
          requests: _requests,
          offers: _offers,
          onRefresh: _refreshAuthenticated,
          onSessionUpdated: (s) => setState(() => _session = s),
          onSignOut: _signOut,
        );
      case 'doctor':
        return DoctorHomeScreen(
          apiClient: _api,
          session: session,
          requests: _requests,
          notifications: _notifications,
          onSessionUpdated: (s) => setState(() => _session = s),
          onRefresh: _refreshAuthenticated,
          onSignOut: _signOut,
        );
      case 'admin':
        return AdminHomeScreen(
          apiClient: _api,
          session: session,
          requests: _requests,
          onRefresh: _refreshAuthenticated,
          onSignOut: _signOut,
        );
      case 'patient':
      default:
        return PatientHomeScreen(
          apiClient: _api,
          session: session,
          hospital: _hospital,
          services: _services,
          requests: _requests,
          isConnected: _socket.connected,
          onRefresh: _refreshAuthenticated,
          onSignOut: _signOut,
        );
    }
  }
}

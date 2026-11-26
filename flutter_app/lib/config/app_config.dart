class AppConfig {
  static const String apiBaseUrl = String.fromEnvironment(
    'HOMEHEAL_API_BASE_URL',
    defaultValue: 'http://10.0.2.2:3000',
  );

  static const String demoPasswordHint = 'HomeHeal@2026';

  static const double defaultHospitalLat = 33.7138;
  static const double defaultHospitalLng = 73.0501;
}

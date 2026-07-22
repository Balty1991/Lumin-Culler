import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

/**
 * Alternativa React Native la Capacitor: o incapsulare nativa subtire in
 * jurul ACELUIASI build web (dist/) folosit si pe GitHub Pages, nu o
 * reimplementare separata. Motivul: pipeline-ul de AI (Web Workers,
 * IndexedDB, backend-ul WebGL al TF.js) exista doar intr-un motor de
 * browser real — React Native nu are echivalente native pentru ele, deci
 * WebView-ul CHIAR e aplicatia, nu doar o vitrina peste una nativa.
 * Pozele si intreaga inferenta ML raman pe dispozitiv exact ca in browser;
 * doar codul (HTML/JS/CSS) se incarca de la ORIGIN.
 *
 * Implicit incarca deploy-ul de pe GitHub Pages. Pentru build complet
 * offline (fara acces la retea la runtime), vezi mobile-rn/README.md —
 * necesita `expo prebuild` + un pas separat de bundling nativ al assets-
 * urilor, care are nevoie de Android Studio/Xcode pentru build si testare.
 */
const ORIGIN = process.env.EXPO_PUBLIC_WEB_APP_ORIGIN ?? 'https://balty1991.github.io/Lumin-Culler/';

export default function App() {
  const [loadError, setLoadError] = useState<string | null>(null);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      {loadError ? (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Nu s-a putut încărca aplicația</Text>
          <Text style={styles.errorBody}>{loadError}</Text>
          <Text style={styles.errorHint}>Origine: {ORIGIN}</Text>
        </View>
      ) : (
        <WebView
          source={{ uri: ORIGIN }}
          style={styles.webview}
          javaScriptEnabled
          domStorageEnabled
          allowFileAccess
          startInLoadingState
          renderLoading={() => (
            <View style={styles.center}>
              <ActivityIndicator size="large" color="#7dd3fc" />
            </View>
          )}
          onError={({ nativeEvent }) => setLoadError(nativeEvent.description ?? 'eroare necunoscută')}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#17181b' },
  webview: { flex: 1, backgroundColor: '#17181b' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  errorTitle: { color: '#f5f5f5', fontSize: 18, fontWeight: '600' },
  errorBody: { color: '#f87171', textAlign: 'center' },
  errorHint: { color: '#9ca3af', textAlign: 'center', fontSize: 13 }
});

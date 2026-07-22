# Lumin Culler Pro — alternativa React Native (Expo)

Proiect Expo separat, independent de `package.json` de la radacina (dependente
diferite: React 19 / React Native 0.86 vs. React 18 din aplicatia web — de
aceea traieste in `mobile-rn/` cu propriul `package.json`, la fel cum
`android/` si `src-tauri/` sunt sub-proiecte native separate).

## Ce este, de fapt

Nu e o reimplementare nativa a pipeline-ului de AI. `App.tsx` incarca
`react-native-webview` peste **acelasi build web** folosit si pe GitHub
Pages. Motivul: Web Workers, IndexedDB si backend-ul WebGL al TF.js nu au
echivalent nativ in React Native — un port "real" ar insemna reconstruirea
separata a intregului `core/` cu `@tensorflow/tfjs-react-native` + `expo-gl`
+ SQLite in loc de IndexedDB, adica un al doilea produs, nu un scaffold.

Fotografiile si toata inferenta ML raman pe dispozitiv exact ca in browser —
doar codul (HTML/JS/CSS) se incarca de la `EXPO_PUBLIC_WEB_APP_ORIGIN`.

## Rulare rapida (implicit — necesita retea la runtime)

```bash
cd mobile-rn
npm install
npx expo start
```

Deschide in Expo Go (scaneaza codul QR). Incarca implicit deploy-ul de pe
GitHub Pages. Pentru alta origine (build local, staging):

```bash
cp .env.example .env
# editeaza EXPO_PUBLIC_WEB_APP_ORIGIN
```

## Build complet offline (fara acces la retea la runtime)

Nu e inclus in acest scaffold — necesita Android Studio/Xcode pentru
build si testare pe device/emulator real, indisponibile in acest mediu.
Pasii pe scurt, pentru cand ai un mediu cu toolchain-ul native:

1. `npx expo prebuild` — genereaza `android/` si `ios/` native (proprii
   acestui sub-proiect, distincte de `android/` de la radacina, care e
   al Capacitor-ului).
2. Copiaza `../dist/` (dupa `npm run build` la radacina) ca assets locale
   in proiectul nativ generat si serveste-le printr-un server static local
   (ex. `@dr.pogodin/react-native-static-server`) sau direct din
   `file:///android_asset/` (Android) / bundle resources (iOS).
3. Schimba `ORIGIN` din `App.tsx` sa indice spre `http://localhost:<port>`
   local in loc de URL-ul GitHub Pages.

## Build/publicare

```bash
npx expo prebuild
npx eas build --platform android   # sau ios — necesita cont EAS
```

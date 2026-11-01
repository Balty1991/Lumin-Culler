# Editorul automat

Corecția care se vede în „Mai frumoasă” e pe telefon, în `src/core/autoLook.ts`.

Pentru fiecare poză se măsoară lumina (medie, umbre, lumini), fața față de rest, dominanta de culoare pe pixelii aproape gri (pielea e lăsată pe din-afară la balans, apoi tenul e corectat separat), ceața, zgomotul, claritatea, cerul de sus și pupilele roșii. Rețeta nu adună orbește peste corecția veche: la fiecare reglaj rămâne valoarea mai hotărâtă, cu plafon, ca o poză bună să nu se „gătească”.

Pe lângă slidere (expunere, umbre, ton local, dezaburire, cer, claritate, reducere de zgomot) mai sunt două lucruri locale:

- **Relight**: fața se deschide în elipsa ei; un fundal foarte aprins, deasupra feței, coboară puțin.
- **Ochi roșii**: pixelii roșii saturați din treimea de sus a feței se sting.

Stilul Portret mai adaugă estomparea fundalului (masca de persoană MediaPipe, când există) și încă puțină lumină pe față.

Grila `docs/auto-look-samples.png` are 12 scene, fiecare cu înainte (stânga) și după (dreapta), numerotate:

1. întuneric
2. supraexpus
3. față în contralumină
4. dominantă albastră
5. lumină de bec (portocaliu)
6. ceață
7. noapte cu zgomot
8. contrast plat
9. cer gri
10. ochi roșii
11. portret întunecat
12. peisaj cu cer spălăcit

Cifrele (lumină înainte/după, dominantă, milisecunde) sunt în `docs/auto-look-samples.json`. Sunt scene desenate, nu poze dintr-o galerie: defectul e controlat, ca diferența să se poată judeca. Pe o poză reală, același cod trece prin `drawAdjusted`.

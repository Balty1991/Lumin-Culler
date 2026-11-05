"""
Compune capturile pentru fișa Play Store.

DE CE ARATA ASA, si nu ca o captura pusa pe un fundal. Prima varianta punea
captura taiata direct pe fundal, cu titlul aliniat la stanga. Utilizatorul a
comparat-o cu setul vechi si a avut dreptate: acela arata profesional, asta nu.
Diferenta nu era gustul, erau patru lucruri concrete:

 1. RAMA DE TELEFON. Fara ea, imaginea citeste ca o captura de ecran. Cu ea,
    citeste ca un PRODUS. E cea mai mare diferenta dintre cele doua seturi.
 2. CAPTURA INTREAGA. Inaltimea ramei se calculeaza DIN raportul sursei, deci
    nu se mai taie nimic si nu mai e nevoie de nicio stingere a marginilor —
    care era o carpeala pentru o problema pe care n-ar fi trebuit s-o avem.
 3. TEXT CENTRAT, cu o eticheta mica deasupra titlului. Eticheta da structura
    ("CONFIDENTIALITATE"), titlul da promisiunea, subtitlul da dovada.
 4. LUMINA COLORATA in fundal, nu un degrade plat: turcoaz sus-stanga, violet
    jos-dreapta. Aceleasi doua culori ca degradeul aplicatiei.

Ruleaza:  python3 scripts/store-screenshots.py

Fontul: Space Grotesk (acelasi ca aplicatia) nu exista ca TTF in proiect, doar
ca subseturi woff2 pentru web — iar subsetul `latin` NU are ă/ș/ț, si
`latin-ext` nu are â/î. Amandoua sunt necesare pentru romana, deci se
instantiaza fiecare la o greutate fixa si se fuzioneaza (fuziunea directa a
doua fonturi VARIABILE esueaza). Vezi `pregateste_fonturile()` mai jos.

Sursele sunt capturi BRUTE de pe telefon. Doua reguli invatate pe pielea
noastra: nicio captura cu adnotari desenate peste ea, si nicio captura cu
persoane care n-au dat acordul sa apara intr-un magazin mondial.
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1080, 1920
SRC = os.environ.get('LUMIN_SHOTS_SRC', '/root/.claude/uploads/dd7d00d0-84cf-5dcc-9e60-641b623909f8')
OUT_BASE = 'store/screenshots-new'
FONTS = '/tmp/fonts'

TEXT = (247, 248, 252)
SUB = (158, 165, 182)
# Tema black rose a aplicației (Cherrypic): roz aprins și un mov-trandafiriu.
TEAL = (255, 128, 166)   # eticheta și conturul insignei (numele vechi păstrat)
VIOLET = (200, 107, 255)

# Bara de stare de sus are inaltime fixa pe acelasi telefon.
CROP_TOP = 118


def taie_bara_de_sistem(im):
    """Taie bara de stare (sus) si bara de navigare a Android-ului (jos).

    Doua feluri de capturi:
     - bara de navigare DESCHISA la culoare (telefonul vechi de test): cautam de
       jos in sus prima linie care nu mai e deschisa — aplicatia e intunecata,
       deci granita e neta;
     - bara NEAGRA cu trei butoane (Honor 8X, EMUI): nu are contrast cu aplicatia,
       asa ca o taiem la proportia ei fixa pe ecranele 9:19.5 (5,1% jos, 3,6% sus).
    Ramasa in rama, bara striga "captura de ecran" — exact ce incearca rama sa ascunda.
    """
    mic = im.convert('L').resize((1, im.height))
    px = mic.load()
    if px[0, im.height - 5] > 110:
        y = im.height - 1
        while y > im.height - 320 and px[0, y] > 110:
            y -= 1
        return im.crop((0, CROP_TOP, im.width, y + 1))
    return im.crop((0, round(im.height * 0.036), im.width, im.height - round(im.height * 0.051)))


def pregateste_fonturile():
    """Space Grotesk cu diacritice romanesti — vezi antetul fisierului."""
    bold, med = f'{FONTS}/SG-bold.ttf', f'{FONTS}/SG-med.ttf'
    if os.path.exists(bold) and os.path.exists(med):
        return bold, med
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer
    from fontTools.merge import Merger
    os.makedirs(FONTS, exist_ok=True)
    src = 'node_modules/@fontsource-variable/space-grotesk/files'
    for name in ['latin', 'latin-ext']:
        f = TTFont(f'{src}/space-grotesk-{name}-wght-normal.woff2')
        f.flavor = None
        f.save(f'{FONTS}/{name}.ttf')
        for w, tag in [(700, 'bold'), (500, 'med')]:
            instancer.instantiateVariableFont(TTFont(f'{FONTS}/{name}.ttf'), {'wght': w}) \
                .save(f'{FONTS}/{name}-{tag}.ttf')
    for tag in ['bold', 'med']:
        Merger().merge([f'{FONTS}/latin-{tag}.ttf', f'{FONTS}/latin-ext-{tag}.ttf']) \
            .save(f'{FONTS}/SG-{tag}.ttf')
    return bold, med


def fundal():
    """Doua lumini colorate peste un fond aproape negru — turcoaz sus-stanga,
    violet jos-dreapta. Aceleasi doua culori ca degradeul aplicatiei."""
    bg = Image.new('RGB', (W, H), (8, 4, 7))
    lum = Image.new('RGB', (W, H), (0, 0, 0))
    d = ImageDraw.Draw(lum)
    d.ellipse([-460, -560, 760, 620], fill=(110, 18, 52))
    d.ellipse([420, H - 900, W + 520, H + 260], fill=(70, 24, 96))
    lum = lum.filter(ImageFilter.GaussianBlur(210))
    return Image.blend(bg, lum, 0.92)


def rotunjeste(im, r):
    m = Image.new('L', im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1], r, fill=255)
    out = im.convert('RGBA')
    out.putalpha(m)
    return out


def randuri(draw, text, font, latime):
    cuvinte, linii, curent = text.split(), [], ''
    for c in cuvinte:
        prob = (curent + ' ' + c).strip()
        if draw.textlength(prob, font=font) <= latime:
            curent = prob
        else:
            if curent:
                linii.append(curent)
            curent = c
    if curent:
        linii.append(curent)
    return linii


def centrat(d, y, text, font, fill, spatiere=0):
    lat = d.textlength(text, font=font) + spatiere * max(0, len(text) - 1)
    x = (W - lat) / 2
    if spatiere:
        for ch in text:
            d.text((x, y), ch, font=font, fill=fill)
            x += d.textlength(ch, font=font) + spatiere
    else:
        d.text((x, y), text, font=font, fill=fill)


def compune(sursa, eticheta, titlu, subtitlu, nume, insigna=None, limba='ro'):
    bold, med = pregateste_fonturile()
    bg = fundal()
    d = ImageDraw.Draw(bg)
    f_et = ImageFont.truetype(bold, 30)
    f_ti = ImageFont.truetype(bold, 76)
    f_su = ImageFont.truetype(med, 36)

    y = 84
    centrat(d, y, eticheta.upper(), f_et, TEAL, spatiere=4.5)
    y += 66
    linii = randuri(d, titlu, f_ti, W - 130)
    for linie in linii:
        centrat(d, y, linie, f_ti, TEXT)
        y += 86
    y += 14
    for linie in randuri(d, subtitlu, f_su, W - 150):
        centrat(d, y, linie, f_su, SUB)
        y += 48

    # ── Telefonul ───────────────────────────────────────────────────────────
    im = Image.open(os.path.join(SRC, sursa)).convert('RGB')
    im = taie_bara_de_sistem(im)

    sus = y + 54
    disponibil = H - sus - 116          # 116 = loc pentru semnatura de jos
    rama = 15                            # grosimea ramei negre
    ecran_lat = 636
    ecran_inalt = round(ecran_lat * im.height / im.width)
    if ecran_inalt + rama * 2 > disponibil:      # nu incape: micsoram TOT, nu taiem
        ecran_inalt = disponibil - rama * 2
        ecran_lat = round(ecran_inalt * im.width / im.height)

    im = im.resize((ecran_lat, ecran_inalt), Image.LANCZOS)
    ecran = rotunjeste(im, 30)

    corp = Image.new('RGB', (ecran_lat + rama * 2, ecran_inalt + rama * 2), (14, 9, 12))
    corp = rotunjeste(corp, 46)
    ImageDraw.Draw(corp).rounded_rectangle(
        [0, 0, corp.width - 1, corp.height - 1], 46, outline=(90, 52, 70), width=2)
    corp.paste(ecran, (rama, rama), ecran)

    x = (W - corp.width) // 2
    umbra = Image.new('RGBA', (corp.width + 130, corp.height + 130), (0, 0, 0, 0))
    umbra.paste((0, 0, 0, 165), (65, 82, 65 + corp.width, 82 + corp.height), corp.split()[3])
    bg.paste(umbra.filter(ImageFilter.GaussianBlur(38)), (x - 65, sus - 65), umbra.filter(ImageFilter.GaussianBlur(38)))
    bg.paste(corp, (x, sus), corp)

    # Insigna care iese peste rama — duce ochiul exact pe afirmatia care conteaza.
    if insigna:
        cap, jos = insigna
        f_c = ImageFont.truetype(bold, 34)
        f_j = ImageFont.truetype(med, 25)
        lat = int(max(d.textlength(cap, font=f_c), d.textlength(jos, font=f_j))) + 56
        pil = Image.new('RGB', (lat, 104), (20, 9, 15))
        pd = ImageDraw.Draw(pil)
        pd.rounded_rectangle([0, 0, lat - 1, 103], 20, outline=TEAL, width=2)
        pd.text(((lat - pd.textlength(cap, font=f_c)) / 2, 18), cap, font=f_c, fill=TEXT)
        pd.text(((lat - pd.textlength(jos, font=f_j)) / 2, 62), jos, font=f_j, fill=SUB)
        pil = rotunjeste(pil, 20)
        bg.paste(pil, (x + corp.width - lat + 46, sus - 46), pil)

    f_b = ImageFont.truetype(bold, 27)
    centrat(d, H - 74, 'CHERRYPIC', f_b, (150, 110, 128), spatiere=3)

    out = f'{OUT_BASE}/{limba}'
    os.makedirs(out, exist_ok=True)
    cale = f'{out}/{nume}.png'
    bg.save(cale)
    print(cale, bg.size)


# ── Textele, pe limbi ────────────────────────────────────────────────────────
#
# ATENTIE, si e o limita reala, nu o scapare: interfata DIN capturi e in
# romana. Setul englezesc de mai jos pune titluri englezesti peste ecrane
# romanesti. Nu e inselator (aplicatia chiar face ce scrie), dar un vorbitor
# de engleza vede diferenta imediat, si asta costa la conversie.
#
# Varianta corecta e sa refaci ACELEASI sase capturi cu aplicatia comutata pe
# EN (Meniu -> Setari -> limba), sa le pui in acelasi folder si sa schimbi doar
# numele fisierelor din `SURSE_EN`. Restul scriptului nu se atinge.
# Numele fișierelor din SRC, pe ecran (se completează când vin capturile noi,
# FĂRĂ oameni în poze — vezi antetul).
SURSE_RO = {
    'sortare': 'f7aaeb5f-image.jpg', 'serii': '14fa3884-image.jpg', 'deoparte': '90df1155-image.jpg',
    'azi': 'a8274629-image.jpg', 'tunel': '6f2725b7-image.jpg', 'seamana': 'c1ad7fe3-image.jpg',
    'studio': '53f0c274-image.jpg', 'momente': '3f0d5d98-image.jpg'
}
SURSE_EN = dict(SURSE_RO)

TEXTE = {
    'ro': [
        ('sortare', 'Alege ca tine', 'Păstrez sau Nu azi',
         'Glisezi, iar AI-ul îți învață gustul din fiecare alegere.', None),
        ('serii', 'Curățenie', 'Din fiecare serie, cea mai bună',
         'Dublurile și pozele mișcate trec la „Nu azi”. Nimic nu se șterge fără tine.', None),
        ('deoparte', 'Ordine', 'Bonuri și capturi, puse deoparte',
         'AI-ul le recunoaște singur și nu ți le mai cere la sortare.', None),
        ('azi', 'Azi', 'Acum un an, în ziua asta',
         'Amintirile tale te găsesc singure, în fiecare zi.', None),
        ('tunel', 'Galerie 3D', 'Călătorește prin anii tăi',
         'Un tunel al amintirilor, lună cu lună, pe fiecare om drag.', None),
        ('seamana', 'Familie', 'Cu cine seamănă copilul?',
         'Comparat după trăsăturile feței, direct pe telefon.', None),
        ('studio', 'Studio', 'Coperta lunii, din pozele tale',
         'Plus filme, Cum a crescut, Capsula timpului și altele.', None),
        ('momente', 'Confidențialitate', 'Pozele tale rămân pe telefon',
         'AI-ul rulează pe telefon. Fără cont, fără reclame.', None)
    ],
    'en': [
        ('sortare', 'Picks like you', 'Keep or Not today',
         'Swipe, and the AI learns your taste from every choice.', None),
        ('serii', 'Cleanup', 'The best shot of every burst',
         'Duplicates and blurry shots move to “Not today”. Nothing is deleted without you.', None),
        ('deoparte', 'Tidy', 'Receipts and screenshots, set aside',
         'The AI spots them on its own and keeps them out of sorting.', None),
        ('azi', 'Today', 'One year ago, on this day',
         'Your memories find you, every day.', None),
        ('tunel', '3D gallery', 'Travel through your years',
         'A tunnel of memories, month by month, for everyone you love.', None),
        ('seamana', 'Family', 'Who does your child look like?',
         'Compared by facial features, right on your phone.', None),
        ('studio', 'Studio', 'Cover of the month, from your photos',
         'Plus films, How they grew, Time capsule and more.', None),
        ('momente', 'Privacy', 'Your photos stay on your phone',
         'The AI runs on your phone. No account, no ads.', None)
    ]
}


if __name__ == '__main__':
    import sys
    limbi = sys.argv[1:] or ['ro', 'en']
    for limba in limbi:
        surse = SURSE_RO if limba == 'ro' else SURSE_EN
        for i, (cheie, et, ti, su, ins) in enumerate(TEXTE[limba], start=1):
            if not surse.get(cheie):
                print('lipsește captura pentru', cheie)
                continue
            compune(surse[cheie], et, ti, su, f'{i:02d}-{cheie}', insigna=ins, limba=limba)

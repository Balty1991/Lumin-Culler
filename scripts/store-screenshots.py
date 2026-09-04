"""
Compune capturile pentru fisa Play Store.

Ce face si de ce:
 - taie bara de stare (ceas, baterie, WhatsApp) si bara de sistem de jos.
   Cine deruleaza prin magazin nu trebuie sa vada ca aveai 33% baterie;
 - pune captura pe un fundal de brand, cu acelasi degrade ca aplicatia;
 - scrie DEASUPRA un titlu scurt. Titlul e ce retine omul — captura doar
   dovedeste ca e adevarat. Doua secunde de derulat, nu un paragraf de citit;
 - foloseste fontul real al aplicatiei (Space Grotesk), nu unul generic.
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

W, H = 1080, 1920
SRC = '/root/.claude/uploads/09c12659-4c3c-54cc-87dd-ec28ff8ac38b'
OUT = 'store/screenshots-new'
BOLD = '/tmp/fonts/SG-bold.ttf'
MED = '/tmp/fonts/SG-med.ttf'

# Culorile aplicatiei (src/styles.css)
BG_TOP = (11, 14, 22)
BG_BOT = (7, 9, 15)
ACCENT = (139, 92, 246)
ACCENT2 = (34, 211, 238)
TEXT = (245, 246, 250)
SUB = (150, 156, 172)

# Cat se taie din sursa (1280x2772): bara de stare sus, bara de sistem jos.
CROP_TOP = 118
CROP_BOT = 130


def fundal():
    """Degrade vertical + o aura de accent sus, ca in aplicatie."""
    bg = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(bg)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3)))
    aura = Image.new('RGB', (W, H), (0, 0, 0))
    ad = ImageDraw.Draw(aura)
    ad.ellipse([-W // 3, -H // 4, W + W // 3, H // 2], fill=(48, 30, 92))
    aura = aura.filter(ImageFilter.GaussianBlur(160))
    return Image.blend(bg, Image.blend(bg, aura, 0.55), 1.0)


def rotunjeste(im, r):
    masca = Image.new('L', im.size, 0)
    ImageDraw.Draw(masca).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1], r, fill=255)
    out = im.convert('RGBA')
    out.putalpha(masca)
    return out


def randuri(draw, text, font, latime):
    """Rupe titlul pe randuri care incap, fara sa taie cuvinte."""
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


def compune(sursa, titlu, subtitlu, nume, offset_y=0):
    bg = fundal()
    d = ImageDraw.Draw(bg)

    f_titlu = ImageFont.truetype(BOLD, 74)
    f_sub = ImageFont.truetype(MED, 40)

    marja = 72
    y = 108
    for linie in randuri(d, titlu, f_titlu, W - marja * 2):
        d.text((marja, y), linie, font=f_titlu, fill=TEXT)
        y += 88
    if subtitlu:
        y += 12
        for linie in randuri(d, subtitlu, f_sub, W - marja * 2):
            d.text((marja, y), linie, font=f_sub, fill=SUB)
            y += 52

    # Linie subtire de accent sub titlu — acelasi degrade ca butonul principal.
    y += 30
    bara = Image.new('RGB', (168, 6))
    bd = ImageDraw.Draw(bara)
    for x in range(168):
        t = x / 168
        bd.line([(x, 0), (x, 6)], fill=tuple(int(ACCENT[i] + (ACCENT2[i] - ACCENT[i]) * t) for i in range(3)))
    bg.paste(rotunjeste(bara, 3), (marja, y), rotunjeste(bara, 3))
    y += 58

    # Captura, taiata de barele de sistem si scalata la latimea disponibila.
    im = Image.open(os.path.join(SRC, sursa)).convert('RGB')
    im = im.crop((0, CROP_TOP, im.width, im.height - CROP_BOT))
    lat = W - marja * 2
    im = im.resize((lat, int(im.height * lat / im.width)), Image.LANCZOS)
    disp = H - y - 64
    if im.height > disp:
        im = im.crop((0, offset_y, im.width, min(im.height, offset_y + disp)))

    # MARGINEA DE JOS SE STINGE in fundal. Captura e mai inalta decat spatiul
    # ramas, deci trebuie taiata undeva — iar o taietura neta prin bara de
    # navigare arata ca o eroare de randare, nu ca un cadru. Stinsa, citeste ca
    # "ecranul continua", ceea ce si e adevarat.
    card = rotunjeste(im, 34)
    alfa = card.split()[3]
    stins = Image.new('L', card.size, 255)
    sd = ImageDraw.Draw(stins)
    # SUS se stinge si el, mai scurt. Captura e taiata la ambele capete, iar o
    # taietura neta prin antet arata exact ca o eroare de randare — raportat cu
    # o captura, cu fasia de antet incercuita. Stinsa, marginea citeste ca
    # "ecranul continua", ceea ce si e adevarat.
    sus = 120
    for i in range(sus):
        sd.line([(0, i), (card.width, i)], fill=int(255 * (i / sus) ** 1.2))
    inaltime_stins = 190
    for i in range(inaltime_stins):
        y_ = card.height - inaltime_stins + i
        sd.line([(0, y_), (card.width, y_)], fill=int(255 * (1 - i / inaltime_stins) ** 1.4))
    card.putalpha(Image.composite(stins, Image.new('L', card.size, 0), alfa))
    umbra = Image.new('RGBA', (card.width + 80, card.height + 80), (0, 0, 0, 0))
    umbra.paste((0, 0, 0, 150), (40, 52, 40 + card.width, 52 + card.height), alfa)
    umbra = umbra.filter(ImageFilter.GaussianBlur(26))
    bg.paste(umbra, (marja - 40, y - 40), umbra)
    bg.paste(card, (marja, y), card)

    os.makedirs(OUT, exist_ok=True)
    cale = f'{OUT}/{nume}.png'
    bg.save(cale)
    print(cale, bg.size)


# ── Cum se refac ────────────────────────────────────────────────────────────
#
#   python3 scripts/store-screenshots.py
#
# Fontul: Space Grotesk (acelasi ca aplicatia) nu exista ca TTF in proiect, doar
# ca subseturi woff2 pentru web — iar subsetul `latin` NU are ă/ș/ț, si
# `latin-ext` nu are â/î. Amandoua sunt necesare pentru romana, deci se
# instantiaza fiecare la o greutate fixa si se fuzioneaza (fuziunea directa a
# doua fonturi VARIABILE esueaza):
#
#   pip install pillow fonttools brotli
#   python3 - <<'EOF'
#   from fontTools.ttLib import TTFont
#   from fontTools.varLib import instancer
#   from fontTools.merge import Merger
#   src = 'node_modules/@fontsource-variable/space-grotesk/files'
#   for name in ['latin', 'latin-ext']:
#       f = TTFont(f'{src}/space-grotesk-{name}-wght-normal.woff2'); f.flavor = None
#       f.save(f'/tmp/fonts/{name}.ttf')
#       for w, tag in [(700, 'bold'), (500, 'med')]:
#           st = instancer.instantiateVariableFont(TTFont(f'/tmp/fonts/{name}.ttf'), {'wght': w})
#           st.save(f'/tmp/fonts/{name}-{tag}.ttf')
#   for tag in ['bold', 'med']:
#       Merger().merge([f'/tmp/fonts/latin-{tag}.ttf', f'/tmp/fonts/latin-ext-{tag}.ttf']) \
#           .save(f'/tmp/fonts/SG-{tag}.ttf')
#   EOF
#
# Sursele sunt capturi BRUTE de pe telefon (1280x2772). Doua reguli invatate pe
# pielea noastra: nicio captura cu adnotari desenate peste ea, si nicio captura
# cu persoane care n-au dat acordul sa apara intr-un magazin mondial.

if __name__ == '__main__':
    compune('25537cf9-image.jpg', 'Un scor pentru fiecare poză',
            'Import, analiză și sortare — oricâte poze, gratuit.', '01-scoruri', offset_y=300)
    compune('40e959de-image.jpg', 'Nu doar cât. Și de ce.',
            'Coada de verificat, grupată pe cauze. Un gest, nu o sută.', '02-cauze', offset_y=240)
    compune('a5734068-image.jpg', 'Fiecare scor, explicat',
            'Ce a cântărit pentru, ce împotrivă. Tu confirmi, AI-ul învață.', '03-de-ce', offset_y=560)
    compune('69016b10-image.jpg', 'Claritate, ochi, zâmbet',
            'Măsurate pe telefon, arătate pe înțelesul tău.', '04-metrici', offset_y=530)
    compune('0dc65acc-image.jpg', 'Îți pregătește următoarea decizie',
            'Tu doar confirmi. Nimic nu se șterge fără acordul tău.', '05-decizie', offset_y=430)
    compune('3f64d51d-image.jpg', '100% pe telefonul tău',
            'Fără cont, fără upload, fără reclame.', '06-privat', offset_y=120)

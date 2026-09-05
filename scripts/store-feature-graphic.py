"""
Imaginea reprezentativa (feature graphic) pentru Play Store — 1024x500.

Cea dinainte scria "Sortare foto cu AI, 100% local — alegi tu, aplicatia
invata": fara diacritice, adica exact defectul pe care l-am scos din descriere.
Intr-o fisa unde restul textelor sunt ingrijite, un singur "aplicatia invata"
lasat asa citeste ca neglijenta, nu ca economie.

Foloseste acelasi fundal si aceleasi fonturi ca `store-screenshots.py`, ca fisa
sa arate ca un intreg: doua lumini colorate — turcoaz sus-stanga, violet
jos-dreapta — nu un degrade plat.

Play decupeaza imaginea pe unele suprafete si suprapune peste ea butoane si
titlu, asa ca tot ce conteaza sta departe de margini si de coltul din
dreapta-jos. Textul e la stanga, sigla la dreapta: cand se taie, se taie din
aer, nu din cuvinte.

Ruleaza:  python3 scripts/store-feature-graphic.py [ro|en]
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module
sg = import_module('store-screenshots'.replace('-', '_')) if False else None

W, H = 1024, 500
TEXT = (247, 248, 252)
SUB = (158, 165, 182)
TEAL = (94, 234, 212)

TEXTE = {
    'ro': ('Sortează mii de poze cu AI,\n100% pe telefonul tău.',
           ['100% pe dispozitiv', 'Fără cont', 'Fără reclame']),
    'en': ('Sort thousands of photos with AI,\n100% on your phone.',
           ['100% on device', 'No account', 'No ads'])
}


def fundal():
    bg = Image.new('RGB', (W, H), (8, 10, 16))
    lum = Image.new('RGB', (W, H), (0, 0, 0))
    d = ImageDraw.Draw(lum)
    d.ellipse([-300, -360, 560, 420], fill=(10, 78, 76))
    d.ellipse([460, H - 320, W + 300, H + 200], fill=(58, 30, 104))
    return Image.blend(bg, lum.filter(ImageFilter.GaussianBlur(150)), 0.92)


def rotunjeste(im, r):
    masca = Image.new('L', im.size, 0)
    ImageDraw.Draw(masca).rounded_rectangle([0, 0, im.width - 1, im.height - 1], r, fill=255)
    out = im.convert('RGBA')
    out.putalpha(masca)
    return out


def compune(limba):
    # Fonturile se pregatesc o data, de scriptul capturilor (Space Grotesk cu
    # diacritice romanesti — vezi antetul lui pentru de ce nu e banal).
    from subprocess import run
    bold, med = '/tmp/fonts/SG-bold.ttf', '/tmp/fonts/SG-med.ttf'
    if not (os.path.exists(bold) and os.path.exists(med)):
        run([sys.executable, 'scripts/store-screenshots.py', 'ro'], check=True)

    bg = fundal()
    d = ImageDraw.Draw(bg)
    f_nume = ImageFont.truetype(bold, 58)
    f_slog = ImageFont.truetype(med, 29)
    f_pil = ImageFont.truetype(med, 20)

    # ── Sigla, in dreapta ───────────────────────────────────────────────────
    latura = 230
    icon = rotunjeste(Image.open('store/icon-512.png').convert('RGB').resize(
        (latura, latura), Image.LANCZOS), 54)
    ix, iy = W - latura - 92, (H - latura) // 2
    stralucire = Image.new('RGBA', (latura + 160, latura + 160), (0, 0, 0, 0))
    stralucire.paste((124, 92, 246, 150), (80, 80, 80 + latura, 80 + latura), icon.split()[3])
    stralucire = stralucire.filter(ImageFilter.GaussianBlur(46))
    bg.paste(stralucire, (ix - 80, iy - 80), stralucire)
    bg.paste(icon, (ix, iy), icon)

    # ── Textul, la stanga ───────────────────────────────────────────────────
    slogan, pilule = TEXTE[limba]
    x = 84
    d.text((x, 150), 'Lumin Culler Pro', font=f_nume, fill=TEXT)
    y = 234
    for linie in slogan.split('\n'):
        d.text((x, y), linie, font=f_slog, fill=SUB)
        y += 40

    y += 22
    for eticheta in pilule:
        w = d.textlength(eticheta, font=f_pil)
        d.rounded_rectangle([x, y, x + w + 34, y + 40], 20, outline=(52, 92, 96), width=2)
        d.text((x + 17, y + 9), eticheta, font=f_pil, fill=TEAL)
        x += w + 34 + 12

    cale = 'store/feature-graphic.png' if limba == 'ro' else f'store/feature-graphic-{limba}.png'
    bg.save(cale)
    print(cale, bg.size)


if __name__ == '__main__':
    for limba in (sys.argv[1:] or ['ro', 'en']):
        compune(limba)

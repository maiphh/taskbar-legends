"""Bake the original dungeon scenery and interface plates. Run with Python 3 + Pillow."""
from pathlib import Path
from random import Random
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "public/ui/dungeon"
OUT.mkdir(exist_ok=True)


def bricks(size, seed, colors, block):
    rng = Random(seed)
    w, h = size
    bw, bh = block
    image = Image.new("RGB", size, colors[0])
    pen = ImageDraw.Draw(image)
    for row, y in enumerate(range(0, h, bh)):
        for x in range(-(row % 2) * bw // 2, w, bw):
            base = rng.choice(colors[1:4])
            pen.rectangle((x + 1, y + 1, x + bw - 1, y + bh - 1), fill=base)
            pen.line((x + 2, y + 1, x + bw - 3, y + 1), fill=colors[4])
            pen.line((x + 3, y + bh - 2, x + rng.randrange(4, bw - 2), y + bh - 2), fill=colors[0])
    return image


def arch(pen, x, y, w, h, color):
    a = w // 4
    pen.polygon([(x, y+h), (x, y+a), (x+a, y), (x+w-a, y), (x+w, y+a), (x+w, y+h)], fill=color)


def torch(pen, x, y):
    pen.rectangle((x-2,y+2,x+2,y+9),fill="#171c28")
    pen.line((x,y+3,x,y+8),fill="#a16b47")
    pen.rectangle((x-3,y+1,x+3,y+3),fill="#c58b4f")
    pen.polygon([(x-2,y),(x-3,y-4),(x-1,y-3),(x+1,y-9),(x+3,y-5),(x+2,y)],fill="#f39450")
    pen.rectangle((x-1,y-3,x+1,y),fill="#ffe7a0")


def corridor():
    image = bricks((256,128), 17, ["#1d2130","#292c3c","#272b39","#2d3040","#333748"], (32,12))
    d = ImageDraw.Draw(image)
    for x in (10,138):
        arch(d,x,18,53,87,"#181e2a")
        arch(d,x+2,19,49,85,"#424050")
        arch(d,x+7,24,39,80,"#131b28")
        arch(d,x+10,28,33,76,"#202234")
        for i in range(4):
            d.rectangle((x+12+i*8,37,x+14+i*8,101),fill="#111823")
        d.line((x+9,52,x+44,52),fill="#161b29",width=3)
        for y in range(37,99,12):
            d.line((x+2,y,x+6,y),fill="#252635")
            d.line((x+47,y,x+50,y),fill="#252635")
    for x in (79,207):
        for off, w, col in [(0,15,"#141b26"),(2,10,"#383b4a"),(3,3,"#454656"),(10,3,"#262a38")]:
            d.rectangle((x+off,0,x+off+w-1,103),fill=col)
        for y in (13,57,91):
            d.rectangle((x-2,y,x+16,y+4), fill="#1a1e2c")
            d.line((x-2,y,x+16,y),fill="#535061")
        # Three hard-edged levels of firelight on the bricks, baked once.
        light = Image.new("RGBA", image.size)
        glow = ImageDraw.Draw(light)
        for radius, alpha in [(19,13), (12,20), (7,29)]:
            cx, cy = x+7, 35
            glow.polygon([(cx-radius,cy-4),(cx-radius+5,cy-11),(cx-4,cy-radius),
                          (cx+4,cy-radius),(cx+radius,cy-5),(cx+radius,cy+4),
                          (cx+5,cy+radius),(cx-5,cy+radius),(cx-radius,cy+5)],
                         fill=(255,166,90,alpha))
        image.paste(light, (0,0), light)
        torch(d,x+7,39)
    d.rectangle((0,99,255,102),fill="#121923")
    for row,(y,ht,bw) in enumerate([(103,6,29),(109,9,43),(118,10,63)]):
        for x in range(-14*row,256,bw):
            d.rectangle((x,y,x+bw-2,y+ht-2),fill="#363543" if (x//bw)%2 else "#393846")
            d.line((x+2,y,x+bw-4,y),fill="#55515a")
    image.save(OUT/"corridor.png")


def keep():
    # Stepped cloud banks, a ruined hilltop keep and its torchlit gate.
    rng = Random(31)
    im = Image.new("RGB",(248,110),"#272b40")
    d = ImageDraw.Draw(im)
    for x in range(55,247,3):
        if rng.randrange(4)==0:
            d.point((x,rng.randrange(1,48)),fill="#858197")
    d.ellipse((161,5,183,27),fill="#d1ba9a")
    d.ellipse((167,2,188,21),fill="#272b40")
    for x,y,w in [(26,27,29),(110,22,42),(190,31,56),(133,35,23),(64,42,33)]:
        d.rectangle((x,y,x+w,y+2),fill="#494658")
        d.rectangle((x+6,y-2,x+w-9,y),fill="#494658")
    for y,col,amp in [(70,"#38384d",20),(82,"#2b3041",14)]:
        pts=[(x,y-rng.randrange(amp)) for x in range(-8,257,7)]
        d.polygon(pts+[(256,110),(0,110)],fill=col)
    def tower(x,y,w,h,roof=False):
        d.rectangle((x,y,x+w,y+h),fill="#4d4957")
        d.rectangle((x+w-4,y,x+w,y+h),fill="#363443")
        for by in range(y+3,y+h,5):
            for bx in range(x+1+(by%3),x+w-4,7):
                if rng.randrange(3)==0: d.line((bx,by,bx+3,by),fill="#645965")
        if roof:
            d.polygon([(x-3,y),(x+w//2,y-16),(x+w+3,y)],fill="#353044")
            d.line((x-3,y,x+w//2,y-16),fill="#926858")
            dx=x+w//2
            d.line((dx,y-16,dx,y-26),fill="#b8a381")
            d.polygon([(dx+1,y-26),(dx+13,y-25),(dx+9,y-22),(dx+1,y-22)],fill="#c76d56")
        else:
            for bx in range(x,x+w,6): d.rectangle((bx,y-3,bx+3,y),fill="#655c66")
        d.rectangle((x-1,y+1,x+w+1,y+3),fill="#77707a")
        for by in range(y+9,y+h-4,13):
            for bx in range(x+4,x+w-4,8):
                d.rectangle((bx,by,bx+2,by+4),fill="#242231")
                if rng.randrange(3): d.line((bx,by+1,bx,by+3),fill="#e3a567")
    tower(149,44,18,46,True)
    tower(168,38,21,48,True)
    tower(188,50,15,38)
    tower(127,62,96,28)
    for x in (122,157,201): tower(x,54 if x!=157 else 48,14,40,x==157)
    arch(d,179,66,16,25,"#282334")
    arch(d,182,70,10,20,"#bf7f57")
    for x in (183,186,189): d.line((x,71,x,82),fill="#513b42")
    d.polygon([(0,102),(65,91),(101,87),(125,82),(147,91),(180,88),(212,92),(247,80),(247,110),(0,110)],fill="#191f2d")
    d.polygon([(181,88),(192,88),(211,100),(200,105),(220,110),(191,110),(183,104),(197,99)],fill="#71605e")
    for x in list(range(26,116,8))+list(range(219,249,7)):
        y=99+rng.randrange(6); h=rng.randrange(12,32)
        for k in range(3):
            top=y-h+k*4; half=2+k*2
            d.polygon([(x,top),(x-half,top+h//2),(x+half,top+h//2)],fill="#1c2832")
    im.save(OUT/"keep.png")


def plates():
    for name,base,edge,light in [
        ("panel","#222634","#454656","#76707a"),("button","#343949","#545766","#888492"),
        ("hover","#444755","#6b6370","#d6bb8e"),("pressed","#292d38","#534a4b","#a28a6c"),
        ("disabled","#252835","#383b48","#555563"),("gold","#dfb678","#865e40","#ffe2a4")]:
        im=Image.new("RGB",(48,48),"#131620"); d=ImageDraw.Draw(im)
        d.rectangle((1,1,46,45),fill=edge)
        d.rectangle((2,2,45,43),fill=base)
        d.line((3,2,44,2),fill=light)
        for x in (3,43):
            for y in (3,42):
                d.rectangle((x-1,y-1,x+2,y+2),fill=edge)
                d.rectangle((x,y,x+1,y+1),fill=light)
        im.save(OUT/(name+".png"))


bricks((96,32),11,["#171a25","#1d202d","#202330","#1d212e","#252836"],(32,8)).save(OUT/"masonry.png")
corridor()
keep()
plates()

# Navigation and wallet pictograms share a 16px grid. Coordinates are source pixels.
def insignia():
    sheet = Image.new("RGBA", (16*8,16))
    for i in range(8):
        im = Image.new("RGBA",(16,16))
        d = ImageDraw.Draw(im)
        gold,shine,bronze,steel,slate = "#dba362","#ffe4a1","#925c42","#c5cede","#75899b"
        if i == 0:  # gatehouse
            for x in (1,10):
                d.rectangle((x,3,x+4,13),fill=slate)
                d.rectangle((x,2,x+1,4),fill=steel)
                d.point((x+4,2),fill=steel)
            d.rectangle((4,6,11,13),fill=gold)
            arch(d,6,8,3,5,"#212433")
        elif i == 1:  # helm
            arch(d,3,2,9,11,steel)
            d.rectangle((3,7,12,9),fill=slate)
            d.rectangle((4,7,11,8),fill="#171d2b")
            d.rectangle((7,6,8,12),fill=gold)
        elif i == 2:  # formation standard
            d.line((3,1,3,14),fill=gold,width=2)
            d.polygon([(5,2),(13,2),(13,11),(9,8),(5,11)],fill="#91c2ae")
            d.line((7,4,11,4),fill="#d4eed4")
        elif i == 3:  # blade
            d.polygon([(3,9),(11,1),(14,1),(14,4),(6,12)],fill=steel)
            d.line((5,10,13,2),fill=slate)
            d.line((2,8,8,14),fill=gold,width=2)
            d.line((5,11,2,14),fill=bronze,width=2)
        elif i == 4:  # sealed summons
            d.rectangle((2,3,13,12),fill=gold)
            d.line((2,4,7,8,13,4),fill=bronze,width=2)
            d.rectangle((6,7,9,10),fill="#bf6761")
        elif i == 5:  # stair
            for j in range(3):
                d.rectangle((2+4*j,10-3*j,5+4*j,13),fill=slate)
                d.line((2+4*j,10-3*j,5+4*j,10-3*j),fill=shine)
        elif i == 6:  # cog
            for r in [(4,3,11,12),(2,5,13,10),(6,1,9,14),(1,6,14,9)]:
                d.rectangle(r,fill=slate)
            d.rectangle((5,5,10,10),fill=steel)
            d.rectangle((6,6,9,9),fill="#262a38")
        else:
            d.rectangle((1,4,14,11),fill=bronze); d.rectangle((2,4,13,10),fill="#b5c2da")
            for x in (1,13): d.rectangle((x,7,x+1,8),fill="#262a38")
            for y in (5,8): d.point((10,y),fill=slate)
        sheet.paste(im,(i*16,0))
    sheet.save(OUT/"insignia.png")


insignia()

"""Bake the original CC0 Summoning Hall backdrop with Python 3 and Pillow."""
from math import cos, pi, sin
from pathlib import Path
from random import Random

from PIL import Image, ImageDraw

rng = Random(271)
w, h = 436, 152
im = Image.new("RGB", (w, h), "#19192a")
d = ImageDraw.Draw(im)
ink, edge, stone = "#191a29", "#706170", "#464152"
brass, gold = "#af8159", "#ffd18a"


def diamond(x, y, r, color):
    d.polygon([(x, y-r), (x+r, y), (x, y+r), (x-r, y)], fill=color)


def arch(x, top, radius, base, color):
    d.polygon([(x-radius, base), (x-radius, top+radius), (x-radius+4, top+radius//2),
               (x-radius//2, top+8), (x, top), (x+radius//2, top+8),
               (x+radius-4, top+radius//2), (x+radius, top+radius), (x+radius, base)], fill=color)


def pennant(x, y, half, length):
    d.polygon([(x-half,y),(x+half,y),(x+half,y+length-7),(x,y+length),(x-half,y+length-7)], fill="#562f47")
    d.polygon([(x-half+2,y),(x+half-3,y),(x+half-3,y+length-9),(x,y+length-4),(x-half+2,y+length-9)], fill="#904555")
    d.rectangle((x-half+4,y,x-half+5,y+length-12),fill=brass)
    d.rectangle((x+half-5,y,x+half-4,y+length-12),fill=brass)
    diamond(x,y+length//2,7,brass)
    diamond(x,y+length//2,4,"#562f47")
    diamond(x,y+length//2,2,gold)
    d.line((x,y+length//2-12,x,y+length//2+11),fill=brass)
    d.line((x-half-3,y,x+half+3,y),fill=gold)


def brazier(x, y):
    d.rectangle((x-2,y,x+2,y+19),fill=ink)
    d.line((x-1,y+4,x-1,y+17), fill=brass)
    d.rectangle((x-6,y+18,x+6,y+20),fill=stone)
    for rad, color in [(11,"#663c43"),(8,"#b65b42"),(5,"#ed974e")]:
        d.polygon([(x-rad,y),(x-rad,y-rad),(x-3,y-rad+2),(x+2,y-rad*2-1),
                   (x+rad-1,y-rad+3),(x+rad,y-2)],fill=color)
    d.polygon([(x-4,y-1),(x-2,y-7),(x,y-5),(x+2,y-12),(x+3,y-1)],fill="#ffe3a3")
    d.polygon([(x-12,y-1),(x+12,y-1),(x+8,y+4),(x+3,y+6),(x-4,y+6),(x-9,y+3)],fill="#392d37")
    d.line((x-11,y-1,x+11,y-1),fill=gold,width=2)
    d.line((x-7,y+3,x+7,y+3),fill=brass)


# Alternating courses and chipped individual stones.
for row, y in enumerate(range(-8,116,8)):
    for x in range(-16*(row%2),w,32):
        color = rng.choice(["#343243","#393647","#322f40","#383445"])
        d.rectangle((x+1,y+1,x+30,y+7),fill=color)
        d.line((x+2,y+1,x+rng.randint(10,27),y+1),fill="#444052")

# Three bays overlook a starry valley. Mask the landscape into each opening.
sky = Image.new("RGB",im.size,"#252d4b")
s = ImageDraw.Draw(sky)
for y,col in [(48,"#303651"),(73,"#413e58"),(89,"#55485c")]:
    s.rectangle((0,y,w,h),fill=col)
for i in range(270):
    x,y = rng.randrange(w),rng.randrange(90)
    s.point((x,y),fill=rng.choice(["#7f839a","#9d93a2","#b5acaa"]))
for y,col,depth in [(86,"#47455e",17),(97,"#33384d",20),(104,"#252b3e",17)]:
    pts=[(x,y-rng.randrange(depth)) for x in range(-4,w+12,9)]
    s.polygon(pts+[(w,h),(0,h)],fill=col)
mask=Image.new("1",im.size)
md=ImageDraw.Draw(mask)
for x,r,top in [(79,27,20),(218,64,-18),(357,27,20)]:
    for inset,col in [(8,ink),(6,edge),(5,stone),(2,"#5c5061"),(1,ink)]:
        arch(x,top-inset,r+inset,113,col)
    md.polygon([(x-r,113),(x-r,top+r),(x-r+4,top+r//2),(x-r//2,top+8),(x,top),
                (x+r//2,top+8),(x+r-4,top+r//2),(x+r,top+r),(x+r,113)],fill=1)
im.paste(sky,(0,0),mask)

# Columns nearest the viewer carry banded capitals and long heraldic banners.
for x in [15,141,295,421]:
    d.rectangle((x-11,0,x+11,117),fill=ink)
    for dx,width,col in [(-9,18,stone),(-8,3,edge),(-3,3,"#534b5e"),(5,3,"#302e40")]:
        d.rectangle((x+dx,0,x+dx+width-1,114),fill=col)
    for y,span in [(7,13),(12,11),(91,11),(99,13),(106,16)]:
        d.rectangle((x-span,y,x+span,y+4),fill="#373444")
        d.line((x-span,y,x+span,y),fill=edge)
        d.line((x-span+2,y+1,x-span+6,y+1),fill="#9a8083")
    pennant(x,16,9,50 if x in (141,295) else 64)

# A pair of chain-hung bronze lanterns.
for x,size in [(57,21),(379,27)]:
    for y in range(0,size,4):
        d.rectangle((x-1,y,x+1,y+2),outline="#84736d")
    d.polygon([(x,size-2),(x+5,size+3),(x+3,size+11),(x,size+14),(x-3,size+11),(x-5,size+3)],fill=brass)
    d.rectangle((x-2,size+4,x+2,size+9),fill=gold)
    d.line((x,size+3,x,size+11),fill="#75554d")

for row,(y,depth,width) in enumerate([(114,5,32),(119,7,43),(126,10,56),(136,16,73)]):
    for x in range(-24*(row%2),w,width):
        d.rectangle((x+1,y,x+width-2,y+depth-2),fill=rng.choice(["#373444","#3b3747","#403a4a"]))
        d.line((x+2,y,x+width-4,y),fill="#564d5a")

# Three carved octagonal steps, brass inlay and a rhombus on the altar lip.
for xrad,y,front in [(85,128,6),(72,123,6),(59,118,6)]:
    pts=[(218-xrad+12,y-5),(218+xrad-12,y-5),(218+xrad,y),
         (218+xrad-12,y+5),(218-xrad+12,y+5),(218-xrad,y)]
    d.polygon([(x,yy+front) for x,yy in pts],fill="#252331")
    d.polygon(pts,fill="#625562")
    d.line(pts[2:]+[pts[0]], fill="#a48779")
    d.line((218-xrad+14,y+7,218+xrad-14,y+7),fill="#775e59")
diamond(218,134,3,gold)
for x in [110,326]:
    brazier(x,102)

# A stone astrolabe behind the summoned hero, with discrete brass markers.
cx,cy,r=218,65,46
for radius,color in [(r+2,ink),(r+1,brass),(r,stone),(r-3,"#756375"),(r-4,ink)]:
    d.ellipse((cx-radius,cy-radius,cx+radius,cy+radius),outline=color,width=1)
for i in range(16):
    angle=i*pi/8
    x,y=round(cx+r*cos(angle)),round(cy+r*sin(angle))
    diamond(x,y,3 if i%4==0 else 1,brass)
    d.point((x,y),fill=gold)
im.save(Path(__file__).resolve().parents[1]/"public/ui/dungeon/summoning-hall.png", optimize=True)

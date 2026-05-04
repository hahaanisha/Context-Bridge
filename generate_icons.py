from PIL import Image, ImageDraw
import math, os

os.makedirs("icons", exist_ok=True)

def make_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin = size * 0.05
    draw.ellipse([margin, margin, size-margin, size-margin], fill=(20, 18, 30, 255))

    cx, cy, r = size/2, size/2, size*0.38
    hex_pts = []
    for i in range(6):
        angle = math.radians(60*i - 30)
        hex_pts.append((cx + r*math.cos(angle), cy + r*math.sin(angle)))
    draw.polygon(hex_pts, fill=(124, 106, 247, 255))

    ar = size * 0.15
    ax, ay = cx, cy - ar*0.3

    draw.rectangle([ax - size*0.03, ay - ar*0.5, ax + size*0.03, ay + ar*0.4], fill=(255,255,255,230))

    pts = [(ax - ar*0.5, ay + ar*0.1), (ax + ar*0.5, ay + ar*0.1), (ax, ay + ar*0.7)]
    draw.polygon(pts, fill=(255,255,255,230))

    draw.rectangle([ax - ar*0.5, ay + ar*0.75, ax + ar*0.5, ay + ar*0.9], fill=(255,255,255,230))

    return img

for size in [16, 32, 48, 128]:
    make_icon(size).save(f"icons/icon{size}.png")
    print(f"icon{size}.png ✓")
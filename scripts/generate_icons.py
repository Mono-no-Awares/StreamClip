import math
import os
import struct
import zlib


def png_chunk(chunk_type, data):
    chunk = chunk_type + data
    return (
        struct.pack(">I", len(data))
        + chunk
        + struct.pack(">I", zlib.crc32(chunk) & 0xFFFFFFFF)
    )


def encode_png(width, height, rgba_bytes):
    raw_rows = bytearray()
    stride = width * 4
    for y in range(height):
        raw_rows.append(0)
        start = y * stride
        raw_rows.extend(rgba_bytes[start : start + stride])
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw_rows), 9)
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", ihdr)
        + png_chunk(b"IDAT", idat)
        + png_chunk(b"IEND", b"")
    )


def sd_rounded_box(px, py, bx, by, r):
    dx = abs(px) - bx + r
    dy = abs(py) - by + r
    outside = math.hypot(max(dx, 0.0), max(dy, 0.0))
    inside = min(max(dx, dy), 0.0)
    return outside + inside - r


def sd_triangle(px, py, ax, ay, bx, by, cx, cy):
    def edge(x0, y0, x1, y1):
        ex, ey = x1 - x0, y1 - y0
        wx, wy = px - x0, py - y0
        t = max(0.0, min(1.0, (wx * ex + wy * ey) / (ex * ex + ey * ey)))
        return (px - (x0 + t * ex), py - (y0 + t * ey), ex * wy - ey * wx)

    e1 = edge(ax, ay, bx, by)
    e2 = edge(bx, by, cx, cy)
    e3 = edge(cx, cy, ax, ay)
    d = min(e1[0] ** 2 + e1[1] ** 2, e2[0] ** 2 + e2[1] ** 2, e3[0] ** 2 + e3[1] ** 2)
    same_sign = (e1[2] >= 0 and e2[2] >= 0 and e3[2] >= 0) or (
        e1[2] <= 0 and e2[2] <= 0 and e3[2] <= 0
    )
    s = -1.0 if same_sign else 1.0
    return s * math.sqrt(d)


def blend(dst, src, alpha):
    inv = 1.0 - alpha
    return (
        dst[0] * inv + src[0] * alpha,
        dst[1] * inv + src[1] * alpha,
        dst[2] * inv + src[2] * alpha,
    )


def render_icon(size):
    buf = bytearray(size * size * 4)
    aa = 1.4 / size
    for y in range(size):
        ny = (y + 0.5) / size * 2.0 - 1.0
        for x in range(size):
            nx = (x + 0.5) / size * 2.0 - 1.0
            d_box = sd_rounded_box(nx, ny, 0.88, 0.88, 0.38)
            box_alpha = max(0.0, min(1.0, 0.5 - d_box / aa))
            if box_alpha <= 0.0:
                continue

            t = max(0.0, min(1.0, (nx + ny + 1.6) / 3.2))
            bg_r = 145 * (1.0 - t) + 28 * t
            bg_g = 70 * (1.0 - t) + 215 * t
            bg_b = 255 * (1.0 - t) + 120 * t
            col = (bg_r, bg_g, bg_b)

            d_inner = sd_rounded_box(nx, ny, 0.72, 0.72, 0.28)
            inner_alpha = max(0.0, min(1.0, 0.5 - d_inner / aa))
            col = blend(col, (16.0, 18.0, 27.0), inner_alpha * 0.88)

            d_play = sd_triangle(nx, ny, -0.22, -0.34, -0.22, 0.34, 0.38, 0.0)
            play_alpha = max(0.0, min(1.0, 0.5 - d_play / aa))
            col = blend(col, (255.0, 255.0, 255.0), play_alpha)

            d_bar = sd_rounded_box(nx, ny - 0.50, 0.44, 0.06, 0.05)
            bar_alpha = max(0.0, min(1.0, 0.5 - d_bar / aa))
            col = blend(col, (83.0, 252.0, 24.0), bar_alpha)

            idx = (y * size + x) * 4
            buf[idx] = int(max(0, min(255, round(col[0]))))
            buf[idx + 1] = int(max(0, min(255, round(col[1]))))
            buf[idx + 2] = int(max(0, min(255, round(col[2]))))
            buf[idx + 3] = int(round(box_alpha * 255))
    return encode_png(size, size, buf)


def main():
    os.makedirs("icons", exist_ok=True)
    for size in (16, 32, 48, 128):
        path = os.path.join("icons", f"icon-{size}.png")
        with open(path, "wb") as f:
            f.write(render_icon(size))


if __name__ == "__main__":
    main()

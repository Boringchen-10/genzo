"""Create a 60-second silent AVI for opt-in PotPlayer tests (standard library only)."""
import pathlib
import struct


def chunk(tag, data):
    return tag + struct.pack("<I", len(data)) + data + (b"\0" if len(data) % 2 else b"")


def listing(tag, data):
    return chunk(b"LIST", tag + data)


directory = pathlib.Path(".tmp/playback-fixture")
directory.mkdir(parents=True, exist_ok=True)
width = height = 32
fps, count, size = 10, 600, width * height * 3
avih = struct.pack("<14I", 100000, size * fps, 0, 16, count, 0, 1, size, width, height, 0, 0, 0, 0)
strh = struct.pack("<4s4sIHHIIIIIIIIhhhh", b"vids", b"DIB ", 0, 0, 0, 0, 1, fps, 0, count, size, 0xffffffff, size, 0, 0, width, height)
strf = struct.pack("<IiiHHIIiiII", 40, width, height, 1, 24, 0, size, 0, 0, 0, 0)
header = listing(b"hdrl", chunk(b"avih", avih) + listing(b"strl", chunk(b"strh", strh) + chunk(b"strf", strf)))
frames, index, offset = [], [], 4
for number in range(count):
    frame = chunk(b"00db", bytes((number % 255, 80, 120)) * width * height)
    frames.append(frame)
    index.append(struct.pack("<4sIII", b"00db", 16, offset, size))
    offset += len(frame)
output = directory / "genzo-progress-test.avi"
output.write_bytes(chunk(b"RIFF", b"AVI " + header + listing(b"movi", b"".join(frames)) + chunk(b"idx1", b"".join(index))))
print(output.resolve())

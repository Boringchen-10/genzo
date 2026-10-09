"""Read the pale synthetic comic recording and measure dark loading blocks."""
import json
import sys
from pathlib import Path

sys.path.insert(0, "D:/DevTools/Android/TestTools/video-audit")
import av
import numpy as np

video_path = Path(sys.argv[1])
samples = []
with av.open(str(video_path)) as video:
    for index, frame in enumerate(video.decode(video=0)):
        rgb = frame.to_ndarray(format="rgb24")
        height, width, _ = rgb.shape
        region = rgb[height-height//5:height-height//30, width//5:width*4//5]
        samples.append({"index": index, "seconds": frame.time,
                        "bottomDarkRatio": float(np.all(region < 45, axis=2).mean())})
result = {"frames": len(samples), "maximumDarkRatio": max(x["bottomDarkRatio"] for x in samples),
          "darkFrames": [x for x in samples if x["bottomDarkRatio"] > .03]}
video_path.with_suffix(".audit.json").write_text(json.dumps({"result": result, "samples": samples}, indent=2))
print(json.dumps(result))
if result["darkFrames"]:
    sys.exit(1)

#!/usr/bin/env python3
"""Edge TTS engine — generates speech MP3 and streams to stdout."""

import sys
import asyncio
import edge_tts

VOICES = {
    # Female voices
    "zh-CN-XiaoxiaoNeural": {"gender": "female", "style": "warm", "pitch": "medium"},
    "zh-CN-XiaoyiNeural": {"gender": "female", "style": "lively", "pitch": "high"},
    "zh-HK-HiuGaaiNeural": {"gender": "female", "style": "friendly", "pitch": "medium"},
    "zh-HK-HiuMaanNeural": {"gender": "female", "style": "friendly", "pitch": "medium"},
    "zh-TW-HsiaoChenNeural": {"gender": "female", "style": "friendly", "pitch": "medium"},
    "zh-TW-HsiaoYuNeural": {"gender": "female", "style": "friendly", "pitch": "high"},
    # Male voices
    "zh-CN-YunjianNeural": {"gender": "male", "style": "passionate", "pitch": "medium"},
    "zh-CN-YunxiNeural": {"gender": "male", "style": "lively", "pitch": "medium"},
    "zh-CN-YunxiaNeural": {"gender": "male", "style": "cute", "pitch": "high"},
    "zh-CN-YunyangNeural": {"gender": "male", "style": "professional", "pitch": "low"},
    "zh-HK-WanLungNeural": {"gender": "male", "style": "friendly", "pitch": "medium"},
    "zh-TW-YunJheNeural": {"gender": "male", "style": "friendly", "pitch": "medium"},
}

# Voice matching: maps audio features to the best Edge TTS voice
# (brightness, rmsDb, dynamicRange) → voice name
def match_voice(brightness: float, rms_db: float, dynamic_range: float) -> str:
    """Match audio features to the closest Edge TTS voice."""
    # Determine gender: low brightness + low RMS → male, high brightness → female
    is_male = brightness < 0.55 and rms_db < -15
    candidates = {k: v for k, v in VOICES.items() if v["gender"] == ("male" if is_male else "female")}

    if not candidates:
        candidates = VOICES

    best = None
    best_score = float("inf")

    for name, meta in candidates.items():
        score = 0
        # Brightness match
        if meta["style"] in ("lively", "passionate", "cute") and brightness > 0.5:
            score -= 2
        elif meta["style"] in ("warm", "professional") and brightness < 0.5:
            score -= 2
        elif meta["style"] == "friendly":
            score -= 1

        # Dynamic range match
        if meta["style"] in ("passionate", "lively") and dynamic_range > 18:
            score -= 2
        elif meta["style"] in ("warm", "professional") and dynamic_range < 14:
            score -= 2

        if score < best_score:
            best_score = score
            best = name

    return best or list(candidates.keys())[0]


async def generate_speech(text: str, voice: str, output_path: str):
    """Generate speech MP3 file using edge-tts."""
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output_path)


async def generate_stream(text: str, voice: str):
    """Generate speech and stream chunks to stdout."""
    communicate = edge_tts.Communicate(text, voice)
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            sys.stdout.buffer.write(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            pass  # Could be used for word-level timing


async def main():
    if len(sys.argv) < 3:
        print("Usage: tts_engine.py <text> <voice> [output.mp3]", file=sys.stderr)
        print("       tts_engine.py --match <brightness> <rmsDb> <dynamicRange>", file=sys.stderr)
        sys.exit(1)

    if sys.argv[1] == "--match":
        brightness = float(sys.argv[2])
        rms_db = float(sys.argv[3])
        dynamic_range = float(sys.argv[4])
        voice = match_voice(brightness, rms_db, dynamic_range)
        print(voice)
        return

    if sys.argv[1] == "--list":
        for name, meta in VOICES.items():
            print(f"{name}\t{meta['gender']}\t{meta['style']}\t{meta['pitch']}")
        return

    text = sys.argv[1]
    voice = sys.argv[2]
    output_path = sys.argv[3] if len(sys.argv) > 3 else None

    if output_path:
        await generate_speech(text, voice, output_path)
    else:
        await generate_stream(text, voice)


if __name__ == "__main__":
    asyncio.run(main())
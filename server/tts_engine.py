#!/usr/bin/env python3
"""Edge TTS engine — generates speech MP3 and streams to stdout."""

import sys
import asyncio
import edge_tts

# All available Chinese voices with detailed attributes
VOICES = {
    # Female — Mandarin
    "zh-CN-XiaoxiaoNeural":  {"gender": "female", "age": "young",  "tone": "warm",     "style": "gentle",    "pitch": "medium"},
    "zh-CN-XiaoyiNeural":    {"gender": "female", "age": "young",  "tone": "bright",   "style": "lively",    "pitch": "high"},
    "zh-CN-XiaochenNeural":  {"gender": "female", "age": "young",  "tone": "bright",   "style": "energetic", "pitch": "high"},
    "zh-CN-XiaohanNeural":   {"gender": "female", "age": "young",  "tone": "warm",     "style": "gentle",    "pitch": "medium"},
    "zh-CN-XiaoruiNeural":   {"gender": "female", "age": "adult",  "tone": "neutral",  "style": "calm",      "pitch": "medium"},
    "zh-CN-XiaoshuangNeural":{"gender": "female", "age": "child",  "tone": "bright",   "style": "cute",      "pitch": "high"},
    "zh-CN-XiaoxuanNeural":  {"gender": "female", "age": "adult",  "tone": "warm",     "style": "elegant",   "pitch": "medium"},
    "zh-CN-XiaoyanNeural":   {"gender": "female", "age": "young",  "tone": "bright",   "style": "lively",    "pitch": "high"},
    "zh-CN-XiaomoNeural":    {"gender": "female", "age": "adult",  "tone": "warm",     "style": "mature",    "pitch": "low"},
    "zh-CN-XiaoqiuNeural":   {"gender": "female", "age": "adult",  "tone": "neutral",  "style": "gentle",    "pitch": "medium"},
    # Female — Dialect
    "zh-CN-liaoning-XiaobeiNeural": {"gender": "female", "age": "adult", "tone": "bright", "style": "humorous", "pitch": "medium"},
    "zh-CN-shaanxi-XiaoniNeural":   {"gender": "female", "age": "adult", "tone": "bright", "style": "lively",   "pitch": "medium"},
    # Male — Mandarin
    "zh-CN-YunxiNeural":     {"gender": "male", "age": "young",  "tone": "bright",   "style": "lively",        "pitch": "medium"},
    "zh-CN-YunjianNeural":   {"gender": "male", "age": "adult",  "tone": "bright",   "style": "passionate",    "pitch": "medium"},
    "zh-CN-YunyangNeural":   {"gender": "male", "age": "adult",  "tone": "warm",     "style": "professional",  "pitch": "low"},
    "zh-CN-YunfengNeural":   {"gender": "male", "age": "adult",  "tone": "warm",     "style": "deep",          "pitch": "low"},
    "zh-CN-YunhaoNeural":    {"gender": "male", "age": "young",  "tone": "bright",   "style": "energetic",     "pitch": "high"},
    "zh-CN-YunxiaNeural":    {"gender": "male", "age": "child",  "tone": "bright",   "style": "cute",          "pitch": "high"},
    "zh-CN-YunyeNeural":     {"gender": "male", "age": "adult",  "tone": "warm",     "style": "deep",          "pitch": "low"},
    # Female — Cantonese / Taiwanese
    "zh-HK-HiuGaaiNeural":   {"gender": "female", "age": "adult", "tone": "neutral", "style": "friendly", "pitch": "medium"},
    "zh-HK-HiuMaanNeural":   {"gender": "female", "age": "young", "tone": "warm",    "style": "friendly", "pitch": "medium"},
    "zh-TW-HsiaoChenNeural": {"gender": "female", "age": "adult", "tone": "neutral", "style": "friendly", "pitch": "medium"},
    "zh-TW-HsiaoYuNeural":   {"gender": "female", "age": "young", "tone": "bright",  "style": "friendly", "pitch": "high"},
    # Male — Cantonese / Taiwanese
    "zh-HK-WanLungNeural":   {"gender": "male", "age": "adult", "tone": "neutral", "style": "friendly", "pitch": "medium"},
    "zh-TW-YunJheNeural":    {"gender": "male", "age": "adult", "tone": "neutral", "style": "friendly", "pitch": "medium"},
}

# Default Mandarin voices (most natural for mainland Chinese)
MANDARIN_VOICES = {k: v for k, v in VOICES.items() if k.startswith("zh-CN-") and "dialect" not in k.lower()}


def match_voice(brightness: float, rms_db: float, dynamic_range: float, silence_ratio: float = 0.3) -> str:
    """
    Match audio features to the closest Edge TTS voice.
    
    Features:
    - brightness (0-1): higher = brighter/lighter voice
    - rms_db (-60 to 0): average volume, louder = more powerful voice
    - dynamic_range (dB): peak - rms, higher = more expressive
    - silence_ratio (0-1): more silence = slower, more deliberate speaker
    """
    # Determine gender from brightness + RMS
    # Low brightness + low RMS = typically male voices
    # High brightness = typically female voices
    gender_score = brightness * 0.6 + (rms_db + 30) / 50 * 0.4
    target_gender = "female" if gender_score > 0.55 else "male"
    
    # Determine age from brightness and dynamic range
    # High brightness + high dynamic = younger
    # Low brightness + low dynamic = older/mature
    age_score = brightness * 0.5 + (dynamic_range / 40) * 0.5
    if age_score > 0.65:
        target_age = "child" if brightness > 0.75 else "young"
    elif age_score < 0.35:
        target_age = "adult"
    else:
        target_age = "young"
    
    # Determine tone from brightness
    if brightness > 0.65:
        target_tone = "bright"
    elif brightness < 0.4:
        target_tone = "warm"
    else:
        target_tone = "neutral"
    
    # Determine style from dynamic range and silence ratio
    if dynamic_range > 20 and silence_ratio < 0.2:
        target_style = "energetic" if target_gender == "female" else "passionate"
    elif dynamic_range > 15:
        target_style = "lively"
    elif silence_ratio > 0.4:
        target_style = "calm"
    elif rms_db > -12:
        target_style = "deep" if target_gender == "male" else "mature"
    else:
        target_style = "professional" if target_gender == "male" else "gentle"
    
    # Score all voices
    best = None
    best_score = float("inf")
    
    candidates = {k: v for k, v in VOICES.items() if v["gender"] == target_gender}
    if not candidates:
        candidates = VOICES
    
    for name, meta in candidates.items():
        score = 0
        
        # Gender match (must match)
        if meta["gender"] != target_gender:
            score += 10
        
        # Age match
        age_order = {"child": 0, "young": 1, "adult": 2}
        score += abs(age_order.get(meta["age"], 1) - age_order.get(target_age, 1)) * 2
        
        # Tone match
        if meta["tone"] == target_tone:
            score -= 3
        elif meta["tone"] == "neutral":
            score -= 1
        
        # Style match
        if meta["style"] == target_style:
            score -= 4
        elif (meta["style"] in ("lively", "energetic") and target_style in ("lively", "energetic")):
            score -= 2
        elif (meta["style"] in ("deep", "mature", "professional") and target_style in ("deep", "mature", "professional")):
            score -= 2
        elif (meta["style"] in ("gentle", "calm", "elegant") and target_style in ("gentle", "calm", "elegant")):
            score -= 2
        
        # Prefer Mandarin voices
        if name.startswith("zh-CN-"):
            score -= 1
        
        if score < best_score:
            best_score = score
            best = name
    
    return best or "zh-CN-XiaoxiaoNeural"


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


async def main():
    if len(sys.argv) < 2:
        print("Usage: tts_engine.py <text> <voice> [output.mp3]", file=sys.stderr)
        print("       tts_engine.py --match <brightness> <rmsDb> <dynamicRange> [silenceRatio]", file=sys.stderr)
        sys.exit(1)

    if sys.argv[1] == "--match":
        brightness = float(sys.argv[2])
        rms_db = float(sys.argv[3])
        dynamic_range = float(sys.argv[4])
        silence_ratio = float(sys.argv[5]) if len(sys.argv) > 5 else 0.3
        voice = match_voice(brightness, rms_db, dynamic_range, silence_ratio)
        print(voice)
        return

    if sys.argv[1] == "--list":
        for name, meta in VOICES.items():
            print(f"{name}\t{meta['gender']}\t{meta['age']}\t{meta['tone']}\t{meta['style']}\t{meta['pitch']}")
        return

    if len(sys.argv) < 3:
        print("Usage: tts_engine.py <text> <voice> [output.mp3]", file=sys.stderr)
        sys.exit(1)

    text = sys.argv[1]
    voice = sys.argv[2]
    output_path = sys.argv[3] if len(sys.argv) > 3 else None

    if output_path:
        await generate_speech(text, voice, output_path)
    else:
        await generate_stream(text, voice)


if __name__ == "__main__":
    asyncio.run(main())
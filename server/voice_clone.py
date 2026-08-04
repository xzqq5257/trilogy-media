#!/usr/bin/env python3
"""
Voice Cloning Engine — extracts voice characteristics from user-uploaded audio
and applies them to Edge TTS output to create a cloned voice.

Pipeline:
  1. Extract voice model from source audio (MFCC, F0, spectral envelope, formants)
  2. Generate base speech with Edge TTS (neutral voice)
  3. Apply voice conversion: F0 adaptation + spectral shaping + energy normalization
"""

import sys
import json
import subprocess
import tempfile
import os
import asyncio
import edge_tts
import numpy as np
import librosa
import soundfile as sf
from scipy import signal
from scipy.interpolate import interp1d

SAMPLE_RATE = 22050  # Standard for voice processing

# ─── Voice Model Extraction ───────────────────────────────────────────

def extract_voice_model(audio_path: str) -> dict:
    """
    Extract a comprehensive voice model from the source audio.
    This model captures the unique acoustic characteristics of the speaker.
    """
    # Load audio, convert to mono
    y, sr = librosa.load(audio_path, sr=SAMPLE_RATE, mono=True)
    
    # Remove silence to focus on voice segments
    y_voice, intervals = librosa.effects.trim(y, top_db=25)
    if len(y_voice) < sr * 0.5:  # At least 0.5s of voice
        y_voice = y
    
    # ── F0 (Pitch) Analysis ──
    f0, voiced_flag, voiced_probs = librosa.pyin(
        y_voice, fmin=librosa.note_to_hz('C2'), fmax=librosa.note_to_hz('C7'),
        sr=SAMPLE_RATE
    )
    f0_valid = f0[voiced_flag] if np.any(voiced_flag) else np.array([150.0])
    f0_mean = float(np.mean(f0_valid))
    f0_std = float(np.std(f0_valid))
    f0_min = float(np.min(f0_valid))
    f0_max = float(np.max(f0_valid))
    f0_median = float(np.median(f0_valid))
    
    # Convert to semitones (relative to A4=440Hz)
    f0_mean_st = float(12 * np.log2(f0_mean / 440.0) + 69)  # MIDI note
    
    # ── MFCC (Timbre Fingerprint) ──
    mfcc = librosa.feature.mfcc(y=y_voice, sr=SAMPLE_RATE, n_mfcc=20)
    mfcc_mean = mfcc.mean(axis=1).tolist()
    mfcc_std = mfcc.std(axis=1).tolist()
    
    # ── Spectral Features ──
    spectral_centroid = float(librosa.feature.spectral_centroid(y=y_voice, sr=SAMPLE_RATE).mean())
    spectral_bandwidth = float(librosa.feature.spectral_bandwidth(y=y_voice, sr=SAMPLE_RATE).mean())
    spectral_rolloff = float(librosa.feature.spectral_rolloff(y=y_voice, sr=SAMPLE_RATE).mean())
    spectral_flatness = float(librosa.feature.spectral_flatness(y=y_voice).mean())
    zero_crossing_rate = float(librosa.feature.zero_crossing_rate(y_voice).mean())
    
    # ── Spectral Envelope (for timbre transfer) ──
    # Compute the average magnitude spectrum of voice segments
    D = librosa.stft(y_voice, n_fft=2048, hop_length=512)
    S = np.abs(D)
    spectral_envelope = S.mean(axis=1).tolist()  # Average magnitude per frequency bin
    
    # ── Energy & Dynamics ──
    rms = librosa.feature.rms(y=y_voice)[0]
    rms_db = float(20 * np.log10(np.mean(rms) + 1e-10))
    rms_std_db = float(20 * np.log10(np.std(rms) + 1e-10))
    peak_db = float(20 * np.log10(np.max(np.abs(y_voice)) + 1e-10))
    dynamic_range = float(peak_db - rms_db)
    
    # ── Formant Estimation (LPC) ──
    # Use LPC to estimate formant frequencies
    formants = _estimate_formants(y_voice, SAMPLE_RATE)
    
    # ── Speaking Rate ──
    # Estimate from zero-crossing rate and energy transitions
    onsets = librosa.onset.onset_detect(y=y_voice, sr=SAMPLE_RATE, 
                                         backtrack=True, units='time')
    if len(onsets) > 1:
        speaking_rate = len(onsets) / (len(y_voice) / SAMPLE_RATE)  # syllables per second
    else:
        speaking_rate = 3.0  # default
    
    # ── Voice Quality ──
    # Harmonic-to-noise ratio
    hnr = librosa.effects.harmonic(y_voice, margin=3.0)
    noise = y_voice - hnr
    hnr_db = float(10 * np.log10(np.sum(hnr**2) / (np.sum(noise**2) + 1e-10)))
    
    # Spectral tilt (brightness of voice)
    tilt = _compute_spectral_tilt(spectral_envelope)
    
    return {
        "f0": {
            "mean_hz": f0_mean,
            "std_hz": f0_std,
            "min_hz": f0_min,
            "max_hz": f0_max,
            "median_hz": f0_median,
            "midi_note": round(f0_mean_st, 1),
        },
        "mfcc": {
            "mean": [round(v, 4) for v in mfcc_mean],
            "std": [round(v, 4) for v in mfcc_std],
        },
        "spectral": {
            "centroid": round(spectral_centroid, 1),
            "bandwidth": round(spectral_bandwidth, 1),
            "rolloff": round(spectral_rolloff, 1),
            "flatness": round(spectral_flatness, 4),
            "zero_crossing_rate": round(zero_crossing_rate, 4),
            "tilt": round(tilt, 3),
        },
        "dynamics": {
            "rms_db": round(rms_db, 1),
            "rms_std_db": round(rms_std_db, 1),
            "peak_db": round(peak_db, 1),
            "dynamic_range": round(dynamic_range, 1),
        },
        "formants": {
            "F1": round(formants[0], 1) if len(formants) > 0 else 0,
            "F2": round(formants[1], 1) if len(formants) > 1 else 0,
            "F3": round(formants[2], 1) if len(formants) > 2 else 0,
        },
        "quality": {
            "hnr_db": round(hnr_db, 1),
            "speaking_rate": round(speaking_rate, 1),
        },
        "duration_sec": round(len(y_voice) / SAMPLE_RATE, 2),
    }


def _estimate_formants(y: np.ndarray, sr: int) -> list:
    """Estimate first three formant frequencies using LPC."""
    try:
        # Use a short segment for stable LPC
        seg_len = min(len(y), sr * 2)  # 2 seconds max
        if seg_len < sr * 0.1:
            return []
        y_seg = y[:seg_len]
        
        # LPC order: sr/1000 + 4 for formants
        order = min(int(sr / 1000) + 4, 20)
        lpc = librosa.lpc(y_seg, order=order)
        
        # Find roots of LPC polynomial
        roots = np.roots(lpc)
        roots = roots[np.imag(roots) > 0]  # Only positive frequencies
        
        # Convert to frequencies
        angles = np.arctan2(np.imag(roots), np.real(roots))
        freqs = angles * (sr / (2 * np.pi))
        
        # Filter to voice formant range (50-4000 Hz)
        freqs = freqs[(freqs > 50) & (freqs < 4000)]
        freqs = np.sort(freqs)
        
        # Take first 3 formants
        return freqs[:3].tolist()
    except Exception:
        return []


def _compute_spectral_tilt(spectral_envelope: list) -> float:
    """Compute spectral tilt (slope of spectrum). Negative = darker voice."""
    if len(spectral_envelope) < 10:
        return 0.0
    x = np.arange(len(spectral_envelope))
    env = np.array(spectral_envelope)
    env_db = 20 * np.log10(env + 1e-10)
    # Linear regression on the slope
    slope, _ = np.polyfit(x, env_db, 1)
    return float(slope)


# ─── Voice Conversion ──────────────────────────────────────────────────

def apply_voice_conversion(
    input_audio: str,
    voice_model: dict,
    output_path: str,
    intensity: float = 1.0,
) -> str:
    """
    Apply voice conversion to make the input audio sound like the voice model.
    
    Steps:
      1. F0 adaptation - shift pitch to match source voice
      2. Spectral shaping - apply EQ based on spectral envelope difference
      3. Energy normalization - match RMS and dynamic range
    
    Args:
        input_audio: Path to the input audio (Edge TTS output)
        voice_model: Voice model dict from extract_voice_model()
        output_path: Path to save the converted audio
        intensity: 0.0-1.0, how strongly to apply the conversion (1.0 = full)
    
    Returns:
        Path to the converted audio file
    """
    y, sr = librosa.load(input_audio, sr=SAMPLE_RATE, mono=True)
    
    # ── Step 1: F0 Adaptation ──
    y = _adapt_f0_librosa(y, sr, voice_model, intensity)
    
    # ── Step 2: Spectral Shaping ──
    y = _apply_spectral_shaping(y, sr, voice_model, intensity)
    
    # ── Step 3: Energy Normalization ──
    y = _normalize_energy(y, voice_model, intensity)
    
    # ── Step 4: Final cleanup ──
    # Remove clicks and normalize
    y = np.clip(y, -0.99, 0.99)
    
    sf.write(output_path, y, sr)
    return output_path


def _adapt_f0_librosa(y: np.ndarray, sr: int, model: dict, intensity: float) -> np.ndarray:
    """
    Adapt the F0 to match the source voice's pitch characteristics.
    Uses librosa's pitch_shift for high-quality pitch modification.
    """
    f0_info = model.get("f0", {})
    target_f0 = f0_info.get("mean_hz", 150.0)
    
    # Estimate current F0
    current_f0 = _estimate_mean_f0(y, sr)
    if current_f0 is None or current_f0 < 50:
        return y
    
    # Calculate semitone shift
    semitone_shift = 12 * np.log2(target_f0 / current_f0) * intensity
    
    # Limit shift to reasonable range
    semitone_shift = np.clip(semitone_shift, -8, 8)
    
    if abs(semitone_shift) < 0.5:
        return y  # Too small to matter
    
    n_steps = int(round(semitone_shift))
    if n_steps == 0:
        return y
    
    # Use librosa's pitch_shift (phase vocoder based)
    return librosa.effects.pitch_shift(y=y, sr=sr, n_steps=n_steps)


def _estimate_mean_f0(y: np.ndarray, sr: int) -> float | None:
    """Estimate mean F0 of audio."""
    try:
        f0, voiced_flag, _ = librosa.pyin(
            y, fmin=librosa.note_to_hz('C2'), fmax=librosa.note_to_hz('C7'),
            sr=sr
        )
        if voiced_flag.any():
            return float(np.mean(f0[voiced_flag]))
    except Exception:
        pass
    return None


def _apply_spectral_shaping(y: np.ndarray, sr: int, model: dict, intensity: float) -> np.ndarray:
    """
    Apply spectral shaping using multi-band EQ based on the source voice's
    spectral characteristics.
    """
    spectral = model.get("spectral", {})
    tilt = spectral.get("tilt", 0.0)
    centroid = spectral.get("centroid", 2000.0)
    
    # Design a multi-band EQ based on spectral features
    # Use scipy's butterworth filters for each band
    
    # Band definitions (Hz)
    bands = [
        (80, 250, "low"),       # Bass/warmth
        (250, 800, "low-mid"),  # Body
        (800, 2500, "mid"),     # Presence
        (2500, 5000, "high-mid"), # Clarity
        (5000, 10000, "high"),  # Air/breath
    ]
    
    y_out = y.copy()
    
    for low_freq, high_freq, band_name in bands:
        gain_db = _compute_band_gain(band_name, model, intensity)
        if abs(gain_db) < 0.5:
            continue
        
        # Apply bandpass filter with gain
        try:
            sos = signal.butter(4, [low_freq, high_freq], btype='band', 
                               fs=sr, output='sos')
            band_signal = signal.sosfilt(sos, y_out)
            gain_linear = 10 ** (gain_db / 20)
            y_out = y_out + (gain_linear - 1) * band_signal
        except Exception:
            pass
    
    return y_out


def _compute_band_gain(band_name: str, model: dict, intensity: float) -> float:
    """
    Compute EQ gain for a frequency band based on voice model.
    This maps the spectral characteristics to reasonable EQ adjustments.
    """
    spectral = model.get("spectral", {})
    f0_info = model.get("f0", {})
    quality = model.get("quality", {})
    formants = model.get("formants", {})
    
    centroid = spectral.get("centroid", 2000.0)
    f0_mean = f0_info.get("mean_hz", 150.0)
    hnr = quality.get("hnr_db", 20.0)
    tilt = spectral.get("tilt", 0.0)
    
    # Reference values (neutral voice)
    ref_centroid = 2000.0
    ref_f0 = 150.0
    
    # Default gains (all zero)
    gains = {"low": 0.0, "low-mid": 0.0, "mid": 0.0, "high-mid": 0.0, "high": 0.0}
    
    # Darker voice (lower centroid) → boost lows, cut highs
    centroid_diff = (centroid - ref_centroid) / ref_centroid
    if centroid_diff < -0.1:  # Darker voice
        gains["low"] = abs(centroid_diff) * 4
        gains["low-mid"] = abs(centroid_diff) * 2
        gains["high"] = centroid_diff * 3
        gains["high-mid"] = centroid_diff * 2
    elif centroid_diff > 0.1:  # Brighter voice
        gains["high"] = centroid_diff * 3
        gains["high-mid"] = centroid_diff * 2
        gains["low"] = -centroid_diff * 2
    
    # Spectral tilt adjustment
    if tilt < -0.05:  # Negative tilt = darker
        gains["low"] += abs(tilt) * 30
        gains["high"] -= abs(tilt) * 20
    elif tilt > 0.05:  # Positive tilt = brighter
        gains["high"] += tilt * 20
        gains["low"] -= tilt * 15
    
    # F0-based adjustment
    if f0_mean < 120:  # Low voice
        gains["low"] += 1.5
        gains["high"] -= 1.0
    elif f0_mean > 220:  # High voice
        gains["high"] += 1.5
        gains["low"] -= 1.0
    
    # HNR adjustment (breathiness)
    if hnr < 15:  # Breathy voice
        gains["high"] += 3.0  # More air
    elif hnr > 25:  # Clear voice
        gains["mid"] += 1.5  # More presence
    
    # Apply intensity
    gain = gains.get(band_name, 0.0) * intensity
    
    # Clamp to reasonable range
    return float(np.clip(gain, -6, 6))


def _normalize_energy(y: np.ndarray, model: dict, intensity: float) -> np.ndarray:
    """Normalize energy to match source voice's RMS level."""
    dynamics = model.get("dynamics", {})
    target_rms_db = dynamics.get("rms_db", -20.0)
    
    current_rms = np.sqrt(np.mean(y ** 2))
    current_rms_db = 20 * np.log10(current_rms + 1e-10)
    
    diff_db = (target_rms_db - current_rms_db) * intensity
    diff_db = np.clip(diff_db, -12, 12)
    
    gain = 10 ** (diff_db / 20)
    return y * gain


# ─── High-Quality Pitch Shifting with ffmpeg rubberband ────────────────

def apply_rubberband_pitch(input_path: str, output_path: str, semitones: float) -> str:
    """
    Apply high-quality pitch shifting using ffmpeg rubberband filter.
    This produces better results than librosa for large pitch shifts.
    """
    cmd = [
        "ffmpeg", "-y", "-i", input_path,
        "-af", f"rubberband=pitch={semitones}:tempo=1.0:formant=1",
        "-q:a", "2",
        output_path
    ]
    subprocess.run(cmd, capture_output=True)
    return output_path


def apply_rubberband_eq(input_path: str, output_path: str, 
                         eq_params: list[tuple[float, float, float]]) -> str:
    """
    Apply multi-band EQ using ffmpeg equalizer.
    eq_params: list of (frequency, width, gain_db)
    """
    if not eq_params:
        return input_path
    
    filters = []
    for freq, width, gain in eq_params:
        filters.append(f"equalizer=f={freq}:t=q:w={width}:g={gain}")
    
    filter_chain = ",".join(filters)
    cmd = [
        "ffmpeg", "-y", "-i", input_path,
        "-af", filter_chain,
        "-q:a", "2",
        output_path
    ]
    subprocess.run(cmd, capture_output=True)
    return output_path


# ─── Full Pipeline ─────────────────────────────────────────────────────

async def generate_speech_with_cloned_voice(
    text: str,
    voice_model_path: str,
    output_path: str,
) -> str:
    """
    Generate speech using the cloned voice model.
    
    1. Load voice model
    2. Generate base speech with Edge TTS (neutral voice)
    3. Apply voice conversion to match the cloned voice
    """
    # Load voice model
    with open(voice_model_path, 'r') as f:
        voice_model = json.load(f)
    
    with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp:
        base_audio_path = tmp.name
    
    try:
        # Generate base speech with Edge TTS
        base_voice = _select_base_voice(voice_model)
        communicate = edge_tts.Communicate(text, base_voice)
        await communicate.save(base_audio_path)
    except Exception as e:
        # Edge TTS unavailable (network issue) — generate local synthetic voice
        print(f"Edge TTS unavailable, using local synthesis: {e}", file=sys.stderr)
        _generate_local_tts(text, base_audio_path, voice_model)
    
    # Apply voice conversion
    try:
        apply_voice_conversion(base_audio_path, voice_model, output_path)
    finally:
        try:
            os.unlink(base_audio_path)
        except Exception:
            pass
    
    return output_path


def _generate_local_tts(text: str, output_path: str, voice_model: dict):
    """Generate a simple synthetic voice locally using ffmpeg when Edge TTS is unavailable."""
    f0_info = voice_model.get("f0", {})
    f0 = f0_info.get("mean_hz", 150.0)
    
    # Estimate duration based on text length (roughly 0.3s per Chinese character)
    duration = max(len(text) * 0.3, 1.0)
    
    # Generate a voice-like tone with harmonics
    # Use ffmpeg to create a sine wave with harmonics
    harmonics = [
        (f0, 0.5),       # Fundamental
        (f0 * 2, 0.25),  # 2nd harmonic
        (f0 * 3, 0.12),  # 3rd harmonic
        (f0 * 4, 0.05),  # 4th harmonic
    ]
    
    # Build ffmpeg filter for adding harmonics
    filter_parts = []
    for i, (freq, amp) in enumerate(harmonics):
        if i == 0:
            filter_parts.append(f"sine=frequency={freq}:duration={duration}:volume={amp}")
        else:
            filter_parts.append(f"sine=frequency={freq}:duration={duration}:volume={amp}")
    
    # Use a single sine generator with rich harmonics via amix
    inputs = "".join(f"-f lavfi -i '{p}' " for p in filter_parts)
    amix_inputs = f"[{''.join(f'[{i}:a]' for i in range(len(harmonics)))}]"
    amix = f"amix=inputs={len(harmonics)}:duration=first:dropout_transition=0"
    
    # Apply a simple envelope for natural fade
    fade = f"afade=t=in:d=0.05,afade=t=out:st={duration - 0.1}:d=0.1"
    
    cmd = (
        f"ffmpeg -y "
        + " ".join(f"-f lavfi -i 'sine=frequency={freq}:duration={duration}' " for freq, _ in harmonics)
        + f"-filter_complex '{amix_inputs}{amix}[mixed];[mixed]{fade}' "
        + f"-map '[mixed]' -t {duration} '{output_path}'"
    )
    
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        # Simple fallback: just use a single sine
        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi",
            "-i", f"sine=frequency={f0}:duration={duration}",
            "-t", str(duration), output_path
        ], capture_output=True)


def _select_base_voice(voice_model: dict) -> str:
    """
    Select the best Edge TTS voice as base for conversion.
    The base voice should be as neutral as possible to allow the voice
    model's characteristics to dominate after conversion.
    """
    f0_info = voice_model.get("f0", {})
    spectral = voice_model.get("spectral", {})
    f0_mean = f0_info.get("mean_hz", 150.0)
    centroid = spectral.get("centroid", 2000.0)
    
    # Choose base voice based on gender (determined by F0)
    # F0 < 175 Hz → male, F0 >= 175 Hz → female
    if f0_mean < 175:
        # Male base voices
        if centroid < 1500:
            return "zh-CN-YunfengNeural"  # Deep, warm male
        elif centroid > 2500:
            return "zh-CN-YunhaoNeural"   # Bright, energetic male
        else:
            return "zh-CN-YunyangNeural"  # Professional, neutral male
    else:
        # Female base voices
        if centroid < 1800:
            return "zh-CN-XiaomoNeural"   # Mature, warm female
        elif centroid > 2800:
            return "zh-CN-XiaochenNeural" # Bright, energetic female
        else:
            return "zh-CN-XiaoxiaoNeural" # Warm, gentle female (most neutral)


async def generate_demo(text: str, voice_model_path: str, output_path: str) -> str:
    """Generate a demo audio clip for previewing the cloned voice."""
    return await generate_speech_with_cloned_voice(text, voice_model_path, output_path)


# ─── CLI ────────────────────────────────────────────────────────────────

async def main():
    if len(sys.argv) < 2:
        print("Usage:", file=sys.stderr)
        print("  voice_clone.py extract <audio_path> <model_output.json>", file=sys.stderr)
        print("  voice_clone.py generate <text> <model.json> <output.mp3>", file=sys.stderr)
        print("  voice_clone.py demo <text> <model.json> <output.mp3>", file=sys.stderr)
        sys.exit(1)
    
    cmd = sys.argv[1]
    
    if cmd == "extract":
        audio_path = sys.argv[2]
        model_path = sys.argv[3]
        model = extract_voice_model(audio_path)
        with open(model_path, 'w') as f:
            json.dump(model, f, indent=2)
        print(f"Voice model saved to {model_path}")
        print(f"  F0: {model['f0']['mean_hz']:.1f} Hz (MIDI {model['f0']['midi_note']})")
        print(f"  Centroid: {model['spectral']['centroid']:.0f} Hz")
        print(f"  Formants: F1={model['formants']['F1']:.0f} F2={model['formants']['F2']:.0f} F3={model['formants']['F3']:.0f}")
        print(f"  RMS: {model['dynamics']['rms_db']:.1f} dB, Dynamic Range: {model['dynamics']['dynamic_range']:.1f} dB")
        print(f"  HNR: {model['quality']['hnr_db']:.1f} dB, Speaking Rate: {model['quality']['speaking_rate']:.1f} syl/s")
    
    elif cmd == "generate":
        text = sys.argv[2]
        model_path = sys.argv[3]
        output_path = sys.argv[4]
        await generate_speech_with_cloned_voice(text, model_path, output_path)
        print(f"Generated: {output_path}")
    
    elif cmd == "demo":
        text = sys.argv[2]
        model_path = sys.argv[3]
        output_path = sys.argv[4]
        await generate_demo(text, model_path, output_path)
        print(f"Demo: {output_path}")


if __name__ == "__main__":
    asyncio.run(main())
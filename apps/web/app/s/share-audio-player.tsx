"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Music, Pause, Play, Volume2, VolumeX } from "lucide-react";

type ShareAudioPlayerProps = {
  src: string;
  fileName: string;
};

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function ShareAudioPlayer({ src, fileName }: ShareAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => {
      setDuration(audio.duration);
      setIsLoaded(true);
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      void audio.play();
    }
  }, [isPlaying]);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !isMuted;
    setIsMuted(!isMuted);
  }, [isMuted]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const t = Number(e.target.value);
    audio.currentTime = t;
    setCurrentTime(t);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="sp-player" data-playing={isPlaying}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Visual area */}
      <div className="sp-visual" aria-hidden="true">
        <Music className="sp-visual-icon" size={40} strokeWidth={1.25} />
      </div>

      {/* Controls */}
      <div className="sp-controls">
        <button
          className="sp-play-btn"
          onClick={togglePlay}
          aria-label={isPlaying ? "Pause" : "Play"}
          disabled={!isLoaded}
          type="button"
        >
          {isPlaying ? (
            <Pause size={20} fill="currentColor" strokeWidth={0} />
          ) : (
            <Play
              size={20}
              fill="currentColor"
              strokeWidth={0}
              style={{ marginLeft: "2px" }}
            />
          )}
        </button>

        <div className="sp-scrubber-area">
          <div className="sp-scrubber-track">
            <div className="sp-scrubber-bg" />
            <div
              className="sp-scrubber-fill"
              style={{ width: `${progress}%` }}
            />
            <input
              type="range"
              className="sp-scrubber"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              disabled={!isLoaded}
              aria-label="Seek"
            />
          </div>
          <div className="sp-time">
            <span>{fmt(currentTime)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>

        <button
          className="sp-mute-btn"
          onClick={toggleMute}
          aria-label={isMuted ? "Unmute" : "Mute"}
          type="button"
        >
          {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
      </div>
    </div>
  );
}

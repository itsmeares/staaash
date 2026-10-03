"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
    <div
      className="group overflow-hidden rounded-xl border border-hairline bg-hover"
      data-playing={isPlaying}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} src={src} preload="metadata" />

      <div
        className="relative flex h-32 items-center justify-center overflow-hidden bg-selected"
        aria-hidden="true"
      >
        <Music
          className="text-primary opacity-35 transition-opacity duration-300 group-data-[playing=true]:animate-pulse group-data-[playing=true]:opacity-55 motion-reduce:animate-none motion-reduce:transition-none"
          size={40}
          strokeWidth={1.25}
        />
      </div>

      <div className="flex items-center gap-3.5 px-4.5 pt-3.5 pb-4.5">
        <Button
          size="icon"
          onClick={togglePlay}
          aria-label={isPlaying ? "Pause" : "Play"}
          disabled={!isLoaded}
          type="button"
        >
          {isPlaying ? (
            <Pause fill="currentColor" strokeWidth={0} />
          ) : (
            <Play className="ml-0.5" fill="currentColor" strokeWidth={0} />
          )}
        </Button>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="relative flex h-5 cursor-pointer items-center">
            <div className="pointer-events-none absolute inset-x-0 h-0.75 rounded-xs bg-line-strong" />
            <div
              className="pointer-events-none absolute left-0 h-0.75 max-w-full rounded-xs bg-primary"
              style={{ width: `${progress}%` }}
            />
            <input
              type="range"
              className="absolute inset-0 m-0 size-full cursor-pointer appearance-none p-0 opacity-0 disabled:cursor-not-allowed"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              disabled={!isLoaded}
              aria-label="Seek"
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
            <span>{fmt(currentTime)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>

        <Button
          variant="outline"
          size="icon-xs"
          onClick={toggleMute}
          aria-label={isMuted ? "Unmute" : "Mute"}
          type="button"
        >
          {isMuted ? <VolumeX /> : <Volume2 />}
        </Button>
      </div>
    </div>
  );
}

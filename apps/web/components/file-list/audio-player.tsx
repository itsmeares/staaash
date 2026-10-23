
import { Music, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { MiddleName } from "./middle-name";

const clock = (seconds: number) => {
  if (!Number.isFinite(seconds)) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/** The viewer's audio player: cover, name, our own scrubber, big play. */
export function AudioPlayer({
  src,
  name,
  coverUrl,
}: {
  src: string;
  name: string;
  coverUrl?: string | null;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [coverFailed, setCoverFailed] = useState(false);

  useEffect(() => {
    void audioRef.current?.play().catch(() => undefined);
  }, [src]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };
  const skip = (by: number) => {
    const audio = audioRef.current;
    if (audio)
      audio.currentTime = Math.max(
        0,
        Math.min(duration, audio.currentTime + by),
      );
  };
  const progress = duration ? (time / duration) * 100 : 0;

  return (
    <div className="grid w-full max-w-sm justify-items-center gap-5 rounded-3xl bg-black/55 p-6 text-white shadow-dialog backdrop-blur-md">
      <audio
        ref={audioRef}
        preload="metadata"
        src={src}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
      />
      {coverUrl && !coverFailed ? (
        <img
          alt=""
          className="aspect-square w-56 rounded-2xl object-cover"
          src={coverUrl}
          onError={() => setCoverFailed(true)}
        />
      ) : (
        <span className="grid aspect-square w-56 place-items-center rounded-2xl bg-linear-to-br from-[#14532d] to-[#4ade80]/80 text-white/85">
          <Music aria-hidden className="size-16" strokeWidth={1.4} />
        </span>
      )}
      <MiddleName className="max-w-full text-body font-medium" name={name} />
      <div className="grid w-full gap-1.5">
        <input
          aria-label="Position"
          className="h-1 w-full cursor-pointer appearance-none rounded-full [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
          max={duration || 0}
          min={0}
          step={0.1}
          style={{
            background: `linear-gradient(90deg, var(--primary) ${progress}%, rgb(255 255 255 / 0.2) ${progress}%)`,
          }}
          type="range"
          value={time}
          onChange={(event) => {
            const audio = audioRef.current;
            if (audio) audio.currentTime = Number(event.target.value);
          }}
        />
        <span className="flex justify-between text-label text-white/80 tabular-nums">
          <span>{clock(time)}</span>
          <span>{clock(duration)}</span>
        </span>
      </div>
      <div className="flex items-center gap-6">
        <button
          aria-label="Back 10 seconds"
          className="grid size-10 cursor-pointer place-items-center rounded-full text-white/85 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white"
          type="button"
          onClick={() => skip(-10)}
        >
          <RotateCcw aria-hidden className="size-5" />
        </button>
        <button
          aria-label={playing ? "Pause" : "Play"}
          className="grid size-14 cursor-pointer place-items-center rounded-full bg-white text-black outline-none hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          type="button"
          onClick={toggle}
        >
          {playing ? (
            <Pause aria-hidden className="size-6 fill-current" />
          ) : (
            <Play aria-hidden className="size-6 translate-x-0.5 fill-current" />
          )}
        </button>
        <button
          aria-label="Forward 10 seconds"
          className="grid size-10 cursor-pointer place-items-center rounded-full text-white/85 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white"
          type="button"
          onClick={() => skip(10)}
        >
          <RotateCw aria-hidden className="size-5" />
        </button>
      </div>
    </div>
  );
}

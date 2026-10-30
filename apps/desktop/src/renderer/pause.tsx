import { ChevronDown, Pause, Play } from "lucide-react";
import { useState } from "react";

import { Button } from "@staaash/ui/components/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@staaash/ui/components/dialog";
import { Input } from "@staaash/ui/components/input";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@staaash/ui/components/menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@staaash/ui/components/select";

import { PAUSE_CHOICES } from "../shared/pause";
import { desktop } from "./state";

const UNITS = { minutes: 1, hours: 60, days: 24 * 60 };
type Unit = keyof typeof UNITS;

export function CustomPauseDialog({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState("3");
  const [unit, setUnit] = useState<Unit>("hours");
  const value = Number(amount);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="sm:max-w-88">
        <DialogHeader>
          <DialogTitle>Pause for</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 px-6 pb-4">
          <Input
            autoFocus
            aria-label="How long"
            inputMode="decimal"
            value={amount}
            onChange={(event) =>
              setAmount(event.target.value.replace(/[^\d.]/g, ""))
            }
          />
          <Select value={unit} onValueChange={(next) => setUnit(next as Unit)}>
            <SelectTrigger aria-label="Unit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(UNITS) as Unit[]).map((each) => (
                <SelectItem key={each} value={each}>
                  {each}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!(value > 0)}
            onClick={() => {
              void desktop.pause(value * UNITS[unit]);
              onClose();
            }}
          >
            Pause
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function PauseButton({
  paused,
  onCustom,
}: {
  paused: boolean;
  onCustom: () => void;
}) {
  if (paused) {
    return (
      <Button onClick={() => void desktop.pause(null)}>
        <Play aria-hidden />
        Resume
      </Button>
    );
  }
  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline" />}>
        <Pause aria-hidden />
        Pause
        <ChevronDown aria-hidden />
      </MenuTrigger>
      <MenuPopup align="end">
        {PAUSE_CHOICES.map((choice) => (
          <div key={choice.label}>
            {choice.minutes === 0 ? <MenuSeparator /> : null}
            <MenuItem onClick={() => void desktop.pause(choice.minutes)}>
              {choice.label}
            </MenuItem>
          </div>
        ))}
        <MenuItem onClick={onCustom}>Custom…</MenuItem>
      </MenuPopup>
    </Menu>
  );
}

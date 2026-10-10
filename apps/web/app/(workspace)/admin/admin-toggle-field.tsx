import { Field, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";

export function AdminToggleField({
  checked,
  defaultChecked,
  disabled,
  label,
  name,
  onChange,
}: {
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  label: string;
  name?: string;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <Field disabled={disabled}>
      <FieldLabel className="min-h-9 gap-3 text-meta">
        <Switch
          name={name}
          checked={checked}
          defaultChecked={defaultChecked}
          disabled={disabled}
          onCheckedChange={(value) => onChange?.(value)}
        />
        {label}
      </FieldLabel>
    </Field>
  );
}

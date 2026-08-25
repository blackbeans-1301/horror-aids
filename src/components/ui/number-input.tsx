import * as React from 'react';

import { Input } from '@/components/ui/input';

// A plain <Input type="number"> is a controlled field bound straight to a
// numeric value, so clearing it to type a fresh number (e.g. to start a
// negative value with "-") makes React coerce Number('') back to 0 on every
// keystroke, snapping the field to 0 before the user can finish typing. This
// wrapper keeps the raw text the user is typing in local state and only
// commits/clamps it to a number on blur (or immediately while typing, if it
// already parses), so intermediate states like "", "-", "-0." are allowed.
interface NumberInputProps
  extends Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

const DRAFT_PATTERN = /^-?\d*\.?\d*$/;

function clamp(value: number, min?: number, max?: number): number {
  let next = value;
  if (typeof min === 'number') {
    next = Math.max(min, next);
  }
  if (typeof max === 'number') {
    next = Math.min(max, next);
  }
  return next;
}

export const NumberInput: React.FC<NumberInputProps> = ({ value, onChange, min, max, ...props }) => {
  const [text, setText] = React.useState<string>(String(value));
  const isFocused = React.useRef(false);

  React.useEffect(() => {
    if (!isFocused.current) {
      setText(String(value));
    }
  }, [value]);

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={text}
      onFocus={() => {
        isFocused.current = true;
      }}
      onChange={(event) => {
        const next = event.target.value;
        if (!DRAFT_PATTERN.test(next)) {
          return;
        }
        setText(next);
        if (next === '' || next === '-') {
          return;
        }
        const parsed = Number(next);
        if (Number.isFinite(parsed)) {
          onChange(parsed);
        }
      }}
      onBlur={() => {
        isFocused.current = false;
        const parsed = Number(text);
        const committed = clamp(Number.isFinite(parsed) ? parsed : value, min, max);
        setText(String(committed));
        if (committed !== value) {
          onChange(committed);
        }
      }}
      {...props}
    />
  );
};

export default NumberInput;

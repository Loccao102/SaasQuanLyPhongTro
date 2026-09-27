"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes
} from "react";

export type DateValueChangeEvent = {
  target: { value: string };
  currentTarget: { value: string };
};

type BaseDateInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue" | "onChange" | "name" | "min" | "max"
> & {
  name?: string;
  value?: string;
  defaultValue?: string;
  min?: string;
  max?: string;
  onChange?: (event: DateValueChangeEvent) => void;
};

function emitDateChange(
  onChange: BaseDateInputProps["onChange"],
  value: string
) {
  onChange?.({
    target: { value },
    currentTarget: { value }
  });
}

function validCalendarDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function formatIsoDateForDisplay(value: string | null | undefined) {
  if (!value) return "";
  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(value);
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

export function parseDisplayDate(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return "";

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, yearText, monthText, dayText] = iso;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    return validCalendarDate(year, month, day) ? text : null;
  }

  const display = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!display) return null;
  const [, dayText, monthText, yearText] = display;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!validCalendarDate(year, month, day)) return null;

  return `${yearText}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatIsoDateTimeForDisplay(value: string | null | undefined) {
  if (!value) return "";
  const match = String(value)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return String(value);
  const [, year, month, day, hour, minute] = match;
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

export function parseDisplayDateTime(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return "";

  const iso = text.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/
  );
  if (iso) {
    const [, yearText, monthText, dayText, hourText, minuteText] = iso;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    if (
      !validCalendarDate(year, month, day) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59
    ) {
      return null;
    }
    return `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}`;
  }

  const display = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})$/
  );
  if (!display) return null;

  const [, dayText, monthText, yearText, hourText, minuteText] = display;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (
    !validCalendarDate(year, month, day) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return `${yearText}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function pickerButton(
  pickerRef: React.RefObject<HTMLInputElement | null>,
  disabled: boolean | undefined,
  label: string
) {
  return (
    <button
      type="button"
      className="date-input__picker-button"
      disabled={disabled}
      aria-label={label}
      onClick={() => {
        const picker = pickerRef.current;
        if (!picker) return;
        if (typeof picker.showPicker === "function") {
          picker.showPicker();
        } else {
          picker.focus();
          picker.click();
        }
      }}
    >
      <span aria-hidden="true">📅</span>
    </button>
  );
}

export function DateInput({
  name,
  value,
  defaultValue,
  min,
  max,
  onChange,
  required,
  disabled,
  className,
  placeholder,
  id,
  ...inputProps
}: BaseDateInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const initialIso = parseDisplayDate(value ?? defaultValue ?? "") ?? "";
  const [isoValue, setIsoValue] = useState(initialIso);
  const [displayValue, setDisplayValue] = useState(
    formatIsoDateForDisplay(initialIso)
  );
  const textRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value === undefined) return;
    const normalized = parseDisplayDate(value) ?? "";
    setIsoValue(normalized);
    setDisplayValue(formatIsoDateForDisplay(normalized));
  }, [value]);

  function validate(display: string, iso: string | null) {
    const input = textRef.current;
    if (!input) return;
    if (!display.trim()) {
      input.setCustomValidity("");
      return;
    }
    if (!iso) {
      input.setCustomValidity("Nhập ngày theo định dạng dd/mm/yyyy.");
      return;
    }
    if (min && iso < min) {
      input.setCustomValidity(
        `Ngày phải từ ${formatIsoDateForDisplay(min)} trở đi.`
      );
      return;
    }
    if (max && iso > max) {
      input.setCustomValidity(
        `Ngày phải trước hoặc bằng ${formatIsoDateForDisplay(max)}.`
      );
      return;
    }
    input.setCustomValidity("");
  }

  function applyIso(nextIso: string, shouldEmit = true) {
    setIsoValue(nextIso);
    setDisplayValue(formatIsoDateForDisplay(nextIso));
    validate(formatIsoDateForDisplay(nextIso), nextIso);
    if (shouldEmit) emitDateChange(onChange, nextIso);
  }

  return (
    <span className="date-input">
      <input
        {...inputProps}
        ref={textRef}
        id={inputId}
        className={className}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder ? formatIsoDateForDisplay(placeholder) : "dd/mm/yyyy"}
        value={displayValue}
        required={required}
        disabled={disabled}
        onChange={(event) => {
          const nextDisplay = event.target.value;
          const parsed = parseDisplayDate(nextDisplay);
          setDisplayValue(nextDisplay);
          setIsoValue(parsed ?? "");
          validate(nextDisplay, parsed);
          if (parsed !== null) emitDateChange(onChange, parsed);
        }}
        onBlur={() => {
          const parsed = parseDisplayDate(displayValue);
          validate(displayValue, parsed);
          if (parsed) {
            setDisplayValue(formatIsoDateForDisplay(parsed));
          }
        }}
      />
      {pickerButton(pickerRef, disabled, "Chọn ngày")}
      <input
        ref={pickerRef}
        className="date-input__native-picker"
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={isoValue}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => applyIso(event.target.value)}
      />
      {name ? <input type="hidden" name={name} value={isoValue} /> : null}
    </span>
  );
}

export function DateTimeInput({
  name,
  value,
  defaultValue,
  min,
  max,
  onChange,
  required,
  disabled,
  className,
  placeholder,
  id,
  ...inputProps
}: BaseDateInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const initialIso = parseDisplayDateTime(value ?? defaultValue ?? "") ?? "";
  const [isoValue, setIsoValue] = useState(initialIso);
  const [displayValue, setDisplayValue] = useState(
    formatIsoDateTimeForDisplay(initialIso)
  );
  const textRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value === undefined) return;
    const normalized = parseDisplayDateTime(value) ?? "";
    setIsoValue(normalized);
    setDisplayValue(formatIsoDateTimeForDisplay(normalized));
  }, [value]);

  function validate(display: string, iso: string | null) {
    const input = textRef.current;
    if (!input) return;
    if (!display.trim()) {
      input.setCustomValidity("");
      return;
    }
    if (!iso) {
      input.setCustomValidity("Nhập ngày giờ theo định dạng dd/mm/yyyy HH:mm.");
      return;
    }
    if (min && iso < min) {
      input.setCustomValidity("Ngày giờ nhỏ hơn giới hạn cho phép.");
      return;
    }
    if (max && iso > max) {
      input.setCustomValidity("Ngày giờ lớn hơn giới hạn cho phép.");
      return;
    }
    input.setCustomValidity("");
  }

  function applyIso(nextIso: string) {
    setIsoValue(nextIso);
    setDisplayValue(formatIsoDateTimeForDisplay(nextIso));
    validate(formatIsoDateTimeForDisplay(nextIso), nextIso);
    emitDateChange(onChange, nextIso);
  }

  return (
    <span className="date-input">
      <input
        {...inputProps}
        ref={textRef}
        id={inputId}
        className={className}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={
          placeholder
            ? formatIsoDateTimeForDisplay(placeholder)
            : "dd/mm/yyyy HH:mm"
        }
        value={displayValue}
        required={required}
        disabled={disabled}
        onChange={(event) => {
          const nextDisplay = event.target.value;
          const parsed = parseDisplayDateTime(nextDisplay);
          setDisplayValue(nextDisplay);
          setIsoValue(parsed ?? "");
          validate(nextDisplay, parsed);
          if (parsed !== null) emitDateChange(onChange, parsed);
        }}
        onBlur={() => {
          const parsed = parseDisplayDateTime(displayValue);
          validate(displayValue, parsed);
          if (parsed) {
            setDisplayValue(formatIsoDateTimeForDisplay(parsed));
          }
        }}
      />
      {pickerButton(pickerRef, disabled, "Chọn ngày và giờ")}
      <input
        ref={pickerRef}
        className="date-input__native-picker"
        type="datetime-local"
        tabIndex={-1}
        aria-hidden="true"
        value={isoValue}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => applyIso(event.target.value)}
      />
      {name ? <input type="hidden" name={name} value={isoValue} /> : null}
    </span>
  );
}

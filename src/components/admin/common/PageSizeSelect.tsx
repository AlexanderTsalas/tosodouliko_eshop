"use client";

interface Props {
  name: string;
  defaultValue: string;
  options: number[];
}

/**
 * Client-only auto-submitting page-size dropdown. Lives in its own file so
 * the parent Pagination component can stay server-rendered (which can't pass
 * event handlers to client primitives).
 */
export default function PageSizeSelect({ name, defaultValue, options }: Props) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      onChange={(e) => e.currentTarget.form?.submit()}
      className="border rounded px-2 py-0.5"
    >
      {options.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}

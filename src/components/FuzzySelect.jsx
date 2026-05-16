import { useEffect, useMemo, useRef, useState } from 'react';
import { filterByFuzzyQuery } from '../service/search.js';

export default function FuzzySelect({
  label,
  value,
  onChange,
  options,
  getOptionValue,
  getOptionLabel,
  getSearchText,
  placeholder = '请选择',
  emptyOptionLabel = '',
  emptyText = '没有匹配项',
  disabled = false,
  className = '',
}) {
  const blurTimer = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selectedOption = useMemo(
    () => options.find((option) => String(getOptionValue(option)) === String(value)),
    [getOptionValue, options, value],
  );
  const selectedLabel = selectedOption ? getOptionLabel(selectedOption) : '';
  const filteredOptions = useMemo(
    () => filterByFuzzyQuery(options, query, (option) => getSearchText?.(option) || getOptionLabel(option)),
    [getOptionLabel, getSearchText, options, query],
  );

  useEffect(() => () => clearTimeout(blurTimer.current), []);

  const close = () => {
    blurTimer.current = setTimeout(() => {
      setOpen(false);
      setQuery('');
    }, 120);
  };

  const selectOption = (nextValue) => {
    onChange(nextValue);
    setOpen(false);
    setQuery('');
  };

  return (
    <label className={`combo-field ${className}`}>
      {label}
      <div className="combo-select">
        <input
          value={open ? query : selectedLabel}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={() => {
            clearTimeout(blurTimer.current);
            setOpen(true);
            setQuery('');
          }}
          onBlur={close}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
        />
        <button
          type="button"
          aria-label="展开选项"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            clearTimeout(blurTimer.current);
            setOpen((prev) => !prev);
            setQuery('');
          }}
        >
          v
        </button>
        {open ? (
          <div className="combo-options">
            {emptyOptionLabel ? (
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => selectOption('')}>
                {emptyOptionLabel}
              </button>
            ) : null}
            {filteredOptions.length === 0 ? (
              <span className="combo-empty">{emptyText}</span>
            ) : filteredOptions.map((option) => {
              const optionValue = getOptionValue(option);
              return (
                <button
                  type="button"
                  key={optionValue}
                  className={String(optionValue) === String(value) ? 'selected' : ''}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(String(optionValue))}
                >
                  {getOptionLabel(option)}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </label>
  );
}

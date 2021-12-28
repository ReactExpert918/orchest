import React from "react";

function parseLocalStorageString<T>(
  itemAsString: string | null,
  defaultValue?: T
) {
  // never saved before
  if (itemAsString === null && defaultValue !== undefined) return defaultValue;
  // it was saved before as undefined, so we take the saved value
  if (itemAsString === "undefined") return undefined;
  return JSON.parse(itemAsString); // including null
}

export const useLocalStorage = <T>(key: string, defaultValue: T) => {
  const privateKey = `orchest.${key}`;

  const cachedItemString = React.useRef<string>();
  const [storedValue, setStoredValue] = React.useState<T>(() => {
    try {
      const item = window.localStorage.getItem(privateKey);
      cachedItemString.current = item;
      return parseLocalStorageString<T>(item, defaultValue);
    } catch (error) {
      console.log(error);
      return defaultValue;
    }
  });

  const setValue = (value: T | ((value: T) => T)) => {
    try {
      const valueToStore =
        value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      cachedItemString.current = JSON.stringify(valueToStore);
      window.localStorage.setItem(privateKey, cachedItemString.current);
    } catch (error) {
      console.log(error);
    }
  };

  // stay sync when the value is updated by other tabs
  React.useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (
        e.storageArea === localStorage &&
        e.key === privateKey &&
        e.newValue !== cachedItemString.current
      ) {
        cachedItemString.current = e.newValue;
        setStoredValue(parseLocalStorageString(e.newValue));
      }
    };

    window.addEventListener("storage", onStorage);

    return () => window.removeEventListener("storage", onStorage);
  }, [privateKey]);

  return [storedValue, setValue] as const;
};

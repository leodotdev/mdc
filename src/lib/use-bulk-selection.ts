import { useState } from "react"

// Shared selection state for the admin tables that support bulk actions.
// Returns the controls a Table needs: a Set of selected ids, header
// "select all" state, per-row toggle, and a clear() for after a bulk op.
export function useBulkSelection(visibleIds: Array<string>) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const allSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))
  const someSelected = visibleIds.some((id) => selected.has(id))

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(visibleIds))

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const clear = () => setSelected(new Set())

  return {
    selected,
    allSelected,
    someSelected,
    toggleAll,
    toggleOne,
    clear,
  }
}

// Run an op against every selected id in parallel, then reset selection.
// Useful inside `mutationFn` of a useMutation that runs bulk actions.
export function runOnAll<T extends string>(
  ids: Array<T>,
  op: (id: T) => Promise<unknown>,
): Promise<Array<unknown>> {
  return Promise.all(ids.map(op))
}

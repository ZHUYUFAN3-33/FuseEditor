import { useCallback, useMemo, useReducer } from 'react'

interface HState<T> {
  past: T[]
  present: T
  future: T[]
  baseline: T | null // snapshot taken at the start of a drag gesture
}

type HAction<T> =
  | { type: 'commit'; next: T } // discrete action — pushes one undo entry
  | { type: 'live'; next: T } // transient update during a gesture — no history
  | { type: 'begin' }
  | { type: 'end' }
  | { type: 'undo' }
  | { type: 'redo' }

function reducer<T>(state: HState<T>, action: HAction<T>): HState<T> {
  switch (action.type) {
    case 'commit':
      if (action.next === state.present) return state
      return { past: [...state.past, state.present], present: action.next, future: [], baseline: null }
    case 'live':
      return { ...state, present: action.next }
    case 'begin':
      return { ...state, baseline: state.present }
    case 'end': {
      const b = state.baseline
      if (b && b !== state.present) {
        return { past: [...state.past, b], present: state.present, future: [], baseline: null }
      }
      return { ...state, baseline: null }
    }
    case 'undo': {
      if (state.past.length === 0) return state
      const prev = state.past[state.past.length - 1]
      return {
        past: state.past.slice(0, -1),
        present: prev,
        future: [state.present, ...state.future],
        baseline: null,
      }
    }
    case 'redo': {
      if (state.future.length === 0) return state
      const next = state.future[0]
      return {
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
        baseline: null,
      }
    }
  }
}

export interface History<T> {
  state: T
  commit: (next: T) => void
  live: (next: T) => void
  beginGesture: () => void
  endGesture: () => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

export function useHistory<T>(initial: T): History<T> {
  const [s, dispatch] = useReducer(reducer<T>, {
    past: [],
    present: initial,
    future: [],
    baseline: null,
  })

  const commit = useCallback((next: T) => dispatch({ type: 'commit', next }), [])
  const live = useCallback((next: T) => dispatch({ type: 'live', next }), [])
  const beginGesture = useCallback(() => dispatch({ type: 'begin' }), [])
  const endGesture = useCallback(() => dispatch({ type: 'end' }), [])
  const undo = useCallback(() => dispatch({ type: 'undo' }), [])
  const redo = useCallback(() => dispatch({ type: 'redo' }), [])

  return useMemo(
    () => ({
      state: s.present,
      commit,
      live,
      beginGesture,
      endGesture,
      undo,
      redo,
      canUndo: s.past.length > 0,
      canRedo: s.future.length > 0,
    }),
    [s.present, s.past.length, s.future.length, commit, live, beginGesture, endGesture, undo, redo],
  )
}

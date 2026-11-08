import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, StyleSheet, TouchableOpacity as NativeTouchableOpacity, Vibration, type TouchableOpacityProps } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import diagnostics from '../onDevice/qwen/diagnostics';

type Preferences = { haptics: boolean; animations: boolean };
const STORAGE_KEY = 'island:interaction:v1';
const defaults: Preferences = { haptics: true, animations: true };
const FeedbackContext = createContext({ ...defaults, reduceMotion: false, update: (_patch: Partial<Preferences>) => {} });
let hapticsEnabled = true;
let lastHaptic = 0;

export function selectionFeedback() {
  if (!hapticsEnabled || Date.now() - lastHaptic < 65) return;
  lastHaptic = Date.now();
  if (Platform.OS === 'android') Vibration.vibrate(8);
  else if (Platform.OS === 'ios') void diagnostics.selectionHaptic();
}

export function InteractionFeedbackProvider({ children }: React.PropsWithChildren) {
  const [preferences, setPreferences] = useState(defaults);
  const [reduceMotion, setReduceMotion] = useState(false);
  const changed = useRef(false);
  const latest = useRef(defaults);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (!active || changed.current || !raw) return;
      const saved = JSON.parse(raw);
      const next = { haptics: saved.haptics !== false, animations: saved.animations !== false };
      latest.current = next; hapticsEnabled = next.haptics; setPreferences(next);
    }).catch(() => undefined);
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active) setReduceMotion(value); }).catch(() => undefined);
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { active = false; listener.remove(); };
  }, []);
  const update = (patch: Partial<Preferences>) => {
    changed.current = true;
    const next = { ...latest.current, ...patch };
    latest.current = next; hapticsEnabled = next.haptics; setPreferences(next);
    // Serialize quick toggle changes so the last choice survives a restart.
    writes.current = writes.current.then(() => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next))).catch(() => undefined);
  };
  return <FeedbackContext.Provider value={{ ...preferences, reduceMotion, update }}>{children}</FeedbackContext.Provider>;
}

export const useInteractionFeedback = () => useContext(FeedbackContext);
const AnimatedTouchable = Animated.createAnimatedComponent(NativeTouchableOpacity);

export function FeedbackTouchable({ style, onPressIn, onPressOut, onPress, disabled, activeOpacity = 0.78, ...props }: TouchableOpacityProps) {
  const { animations, reduceMotion } = useInteractionFeedback();
  const scale = useRef(new Animated.Value(1)).current;
  const canAnimate = animations && !reduceMotion && !disabled;
  const originalTransform = StyleSheet.flatten(style)?.transform;
  useEffect(() => {
    if (!canAnimate) { scale.stopAnimation(); scale.setValue(1); }
    return () => scale.stopAnimation();
  }, [canAnimate, scale]);
  return <AnimatedTouchable {...props} disabled={disabled} activeOpacity={activeOpacity}
    accessibilityRole={props.accessibilityRole || (onPress ? 'button' : undefined)}
    style={[style, canAnimate && { transform: [...(Array.isArray(originalTransform) ? originalTransform : []), { scale }] }]}
    onPressIn={event => {
      if (canAnimate) Animated.timing(scale, { toValue: 0.96, duration: 85, useNativeDriver: true }).start();
      onPressIn?.(event);
    }}
    onPressOut={event => {
      if (canAnimate) Animated.spring(scale, { toValue: 1, speed: 28, bounciness: 4, useNativeDriver: true }).start();
      onPressOut?.(event);
    }}
    onPress={event => { if (onPress && !disabled) { selectionFeedback(); onPress(event); } }} />;
}

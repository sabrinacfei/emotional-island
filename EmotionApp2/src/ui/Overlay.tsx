import React, { createContext, useContext, useEffect, useState } from 'react';
import { Modal as NativeModal, Pressable, ScrollView, StyleSheet, Text, View, type AlertButton, type AlertOptions, type ModalProps, type StyleProp, type ViewStyle } from 'react-native';
import { FeedbackTouchable, useInteractionFeedback } from './InteractionFeedback';

type Notice = { title: string; message?: string; buttons?: AlertButton[]; options?: AlertOptions };
let publish: ((notice: Notice) => void) | undefined;
const NoticeContext = createContext<{ notice: Notice | null; dismiss: () => void }>({ notice: null, dismiss: () => {} });
export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions) {
    publish?.({ title, message, buttons, options });
  },
};

export function NoticeProvider({ children }: React.PropsWithChildren) {
  const [queue, setQueue] = useState<Notice[]>([]);
  useEffect(() => {
    publish = notice => setQueue(previous => [...previous, notice]);
    return () => { publish = undefined; };
  }, []);
  const dismiss = () => setQueue(previous => previous.slice(1));
  return <NoticeContext.Provider value={{ notice: queue[0] || null, dismiss }}>
    {children}
    <NoticeOverlay />
  </NoticeContext.Provider>;
}

function NoticeOverlay() {
  const { notice, dismiss } = useContext(NoticeContext);
  if (!notice) return null;
  const cancel = () => {
    dismiss();
    notice.buttons?.find(button => button.style === 'cancel')?.onPress?.();
    notice.options?.onDismiss?.();
  };
  return <Pressable style={styles.noticeOverlay} onPress={cancel} accessible={false}>
    <View style={styles.noticeCard} accessibilityViewIsModal onAccessibilityEscape={cancel}>
      <ScrollView bounces={false} style={{ maxHeight: 360 }}>
        <Text style={styles.title} accessibilityRole="header">{notice.title}</Text>
        {!!notice.message && <Text style={styles.message}>{notice.message}</Text>}
      </ScrollView>
      <View style={styles.actions}>
        {(notice.buttons?.length ? notice.buttons : [{ text: '我知道了' }]).map((button, index) =>
          <FeedbackTouchable key={index} style={styles.button} onPress={() => { dismiss(); button.onPress?.(); }}>
            <Text style={[styles.buttonText, button.style === 'destructive' && { color: '#C0392B' }]}>{button.text}</Text>
          </FeedbackTouchable>)}
      </View>
    </View>
  </Pressable>;
}

// Mount alerts inside the visible native modal as well as the app root, so they
// remain reachable on iOS without presenting a second native modal over it.
export function DismissibleModal({ children, onClose, overlayStyle, animationType = 'fade', ...props }: ModalProps & { onClose: () => void; overlayStyle: StyleProp<ViewStyle> }) {
  const { animations, reduceMotion } = useInteractionFeedback();
  const { notice, dismiss } = useContext(NoticeContext);
  const close = () => {
    if (notice) { dismiss(); notice.buttons?.find(button => button.style === 'cancel')?.onPress?.(); notice.options?.onDismiss?.(); }
    else onClose();
  };
  return <NativeModal {...props} transparent animationType={animations && !reduceMotion ? animationType : 'none'} onRequestClose={close}>
    <Pressable style={overlayStyle} accessible={false} onPress={onClose}>
      <View style={{ width: '100%' }} accessibilityViewIsModal onAccessibilityEscape={onClose}>{children}</View>
    </Pressable>
    <NoticeOverlay />
  </NativeModal>;
}

const styles = StyleSheet.create({
  noticeOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 10000, elevation: 10000, backgroundColor: 'rgba(40,32,26,0.38)', justifyContent: 'center', alignItems: 'center', padding: 28 },
  noticeCard: { width: '100%', maxWidth: 420, borderRadius: 25, padding: 24, backgroundColor: '#FFFDF8' },
  title: { color: '#3D2B1F', fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 12 },
  message: { color: '#7A6A5A', fontSize: 16, lineHeight: 25 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 22 },
  button: { flexGrow: 1, padding: 13, borderRadius: 22, backgroundColor: '#EAF0E5', alignItems: 'center' },
  buttonText: { color: '#47673A', fontSize: 16, fontWeight: '600' },
});

import React, { useEffect, useRef, useState } from 'react';

import {
  ActivityIndicator,
  ImageBackground,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import {
  PHONE_MODEL,
  downloadModel,
  modelExists,
  verifyModel,
  deleteModel,
} from './qwen/storage';

import { FeedbackTouchable as TouchableOpacity } from '../ui/InteractionFeedback';

import { preparePhoneModel } from './qwen/runtime';
import { nativeModelsAvailable } from './qwen/diagnostics';
import { preparePhoneClassifier } from './modernbert/runtime';

type Stage =
  | 'checking'
  | 'downloading'
  | 'verifying'
  | 'loading'
  | 'ready'
  | 'error';

type Props = {
  onReady: () => void;
};

const BACKGROUND = require('../../assets/model_download_complete_bg.png');

// 背景圖片的參考尺寸
const IMAGE_WIDTH = 706;
const IMAGE_HEIGHT = 1536;

// 省略號位置：稍微往上移動，對齊第二行文字
const DOTS_POSITION = {
  x: 520,
  y: 435,
};

// 綠色轉圈圈：小島下方、白色提示框正上方
const SPINNER_POSITION = {
  x: 353,
  y: 1110,
};

export function PhoneModelPreparationScreen({ onReady }: Props) {
  const [stage, setStage] = useState<Stage>('checking');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [dots, setDots] = useState(0);

  const running = useRef(false);
  const mounted = useRef(true);
  const onReadyRef = useRef(onReady);

  const { width, height } = useWindowDimensions();

  onReadyRef.current = onReady;

  // 根據圖片 cover 模式計算縮放比例
  const scale = Math.max(
    width / IMAGE_WIDTH,
    height / IMAGE_HEIGHT
  );

  const renderedImageWidth = IMAGE_WIDTH * scale;
  const renderedImageHeight = IMAGE_HEIGHT * scale;

  const offsetX = (width - renderedImageWidth) / 2;
  const offsetY = (height - renderedImageHeight) / 2;

  const imageX = (x: number) => offsetX + x * scale;
  const imageY = (y: number) => offsetY + y * scale;

  // 省略號動畫
  // 無 → . → .. → ... → 無
  useEffect(() => {
    const interval = setInterval(() => {
      setDots(previous => (previous + 1) % 4);
    }, 550);

    return () => clearInterval(interval);
  }, []);

  // Qwen 模型準備流程
  const prepare = async () => {
    if (running.current) return;

    running.current = true;

    setError('');
    setProgress(0);
    setStage('checking');

    try {
      if (!nativeModelsAvailable) {
        throw new Error(
          '手機端 AI 需要原生 App，無法在 Expo Go 中使用。'
        );
      }

      const exists = await modelExists();

      if (exists) {
        setStage('verifying');

        try {
          await verifyModel();
        } catch {
          await deleteModel();

          setStage('downloading');
          await downloadModel(setProgress);
        }
      } else {
        setStage('downloading');
        await downloadModel(setProgress);
      }

      setStage('verifying');
      await preparePhoneClassifier();
      setStage('loading');
      await preparePhoneModel();

      if (!mounted.current) return;

      setStage('ready');

      // 模型準備完成後直接進入 App
      onReadyRef.current();

    } catch (e) {
      if (!mounted.current) return;

      setError(
        e instanceof Error
          ? e.message
          : '模型準備失敗，請重新嘗試。'
      );

      setStage('error');

    } finally {
      running.current = false;
    }
  };

  useEffect(() => {
    mounted.current = true;

    void prepare();

    return () => {
      mounted.current = false;
    };
  }, []);

  const percentage = Math.min(
    100,
    Math.max(0, progress * 100)
  );

  const isDownloading = stage === 'downloading';
  const isError = stage === 'error';
  const isReady = stage === 'ready';

  return (
    <ImageBackground
      source={BACKGROUND}
      resizeMode="cover"
      style={{
        flex: 1,
      }}
    >
      {/* ===================================== */}
      {/* 1. 第二行文字後方的省略號動畫 */}
      {/* ===================================== */}

      {!isError && !isReady && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',

            left: imageX(DOTS_POSITION.x),
            top: imageY(DOTS_POSITION.y),

            width: 70 * scale,
            height: 40 * scale,

            justifyContent: 'center',
            alignItems: 'flex-start',
          }}
        >
          <Text
            style={{
              color: '#665044',
              fontSize: 27 * scale,
              fontWeight: '400',
              textAlign: 'left',
              includeFontPadding: false,
            }}
          >
            {'.'.repeat(dots)}
          </Text>
        </View>
      )}

      {/* ===================================== */}
      {/* 2. 小島下方的綠色轉圈圈 */}
      {/* ===================================== */}

      {!isError && !isReady && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',

            left: imageX(SPINNER_POSITION.x) - 22,
            top: imageY(SPINNER_POSITION.y) - 22,

            width: 44,
            height: 44,

            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ActivityIndicator
            size="large"
            color="#91B79B"
          />
        </View>
      )}

      {/* ===================================== */}
      {/* 3. 模型下載百分比 */}
      {/* ===================================== */}

      {isDownloading && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',

            top: imageY(1160),
            left: 0,
            right: 0,

            alignItems: 'center',
          }}
        >
          <Text
            style={{
              fontSize: 16,
              fontWeight: '600',
              color: '#526B58',
            }}
          >
            {PHONE_MODEL.label} · {percentage.toFixed(1)}%
          </Text>
        </View>
      )}

      {/* ===================================== */}
      {/* 4. 模型準備失敗時的提示與重試按鈕 */}
      {/* ===================================== */}

      {isError && (
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 30,
            backgroundColor: 'rgba(255,255,255,0.35)',
          }}
        >
          <View
            style={{
              width: '100%',
              backgroundColor: 'rgba(255,255,255,0.94)',
              borderRadius: 28,
              paddingVertical: 30,
              paddingHorizontal: 24,
              alignItems: 'center',
            }}
          >
            <Text
              style={{
                fontSize: 20,
                fontWeight: '600',
                color: '#665044',
                marginBottom: 16,
              }}
            >
              小島準備遇到一點問題
            </Text>

            <Text
              style={{
                color: '#A45C50',
                fontSize: 15,
                textAlign: 'center',
                lineHeight: 24,
                marginBottom: 24,
              }}
            >
              {error}
            </Text>

            <TouchableOpacity
              onPress={() => void prepare()}
              style={{
                backgroundColor: '#91B79B',
                borderRadius: 30,
                paddingVertical: 15,
                paddingHorizontal: 40,
              }}
            >
              <Text
                style={{
                  color: '#FFFFFF',
                  fontSize: 16,
                  fontWeight: '600',
                }}
              >
                重新嘗試
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ImageBackground>
  );
}

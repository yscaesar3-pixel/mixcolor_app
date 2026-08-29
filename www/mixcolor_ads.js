(() => {
  'use strict';

  const PROD_BANNER_ID = 'ca-app-pub-8174756915786797/4813684806';

  // 実機確認中は true。提出用ビルドへ切り替える直前に false に変更する。
  const TEST_MODE = true;

  const state = {
    plugin: null,
    initialized: false,
    initPromise: null,
    canRequestAds: false,
    privacyRequired: false,
    bannerShown: false,
    bannerWanted: false,
    sizeListenerInstalled: false,
  };

  function isNative() {
    const cap = window.Capacitor;
    if (!cap) return false;
    if (typeof cap.isNativePlatform === 'function') return cap.isNativePlatform();
    if (typeof cap.getPlatform === 'function') return cap.getPlatform() !== 'web';
    return !!cap.Plugins;
  }

  function getAdMob() {
    if (state.plugin) return state.plugin;
    if (!isNative()) return null;

    const cap = window.Capacitor;
    state.plugin =
      cap?.Plugins?.AdMob ||
      (typeof cap?.registerPlugin === 'function' ? cap.registerPlugin('AdMob') : null);

    return state.plugin;
  }

  function setCssAdHeight(height) {
    const px = Math.max(0, Number(height) || 0);
    document.documentElement.style.setProperty('--mixcolor-ad-height', `${px}px`);
  }

  function setPageAdVisible(visible) {
    document.body?.classList.toggle('mixcolor-ad-visible', !!visible);
  }

  function refreshPrivacyButtons() {
    document.querySelectorAll('[data-mixcolor-ad-privacy]').forEach((btn) => {
      btn.style.display = state.privacyRequired ? '' : 'none';
      btn.disabled = !state.initialized;
    });
  }

  async function installSizeListener() {
    if (state.sizeListenerInstalled) return;
    const AdMob = getAdMob();
    if (!AdMob || typeof AdMob.addListener !== 'function') return;
    state.sizeListenerInstalled = true;

    try {
      await AdMob.addListener('bannerAdSizeChanged', (info) => {
        setCssAdHeight(info?.height || 60);
        if (state.bannerShown) setPageAdVisible(true);
      });
    } catch (e) {
      console.warn('[MIX COLOR][AdMob] size listener:', e);
    }
  }

  async function init() {
    if (state.initPromise) return state.initPromise;

    state.initPromise = (async () => {
      const AdMob = getAdMob();

      // PCブラウザではネイティブ広告を使わない。
      if (!AdMob) {
        state.initialized = true;
        state.canRequestAds = false;
        refreshPrivacyButtons();
        return false;
      }

      try {
        await AdMob.initialize();

        // ATT APIは意図的に一切呼ばない。
        let consentInfo = await AdMob.requestConsentInfo();

        if (
          consentInfo?.isConsentFormAvailable &&
          consentInfo?.status === 'REQUIRED'
        ) {
          consentInfo = await AdMob.showConsentForm();
        }

        state.canRequestAds = !!consentInfo?.canRequestAds;
        state.privacyRequired =
          consentInfo?.privacyOptionsRequirementStatus === 'REQUIRED';
        state.initialized = true;

        await installSizeListener();
        refreshPrivacyButtons();

        if (state.bannerWanted && state.canRequestAds) {
          await showBannerInternal();
        }

        return state.canRequestAds;
      } catch (e) {
        state.initialized = true;
        state.canRequestAds = false;
        refreshPrivacyButtons();
        console.warn('[MIX COLOR][AdMob] initialization/consent failed:', e);
        return false;
      }
    })();

    return state.initPromise;
  }

  async function showBannerInternal() {
    const AdMob = getAdMob();
    if (!AdMob || !state.canRequestAds || !state.bannerWanted) return false;

    try {
      // HTMLページ遷移後に前ページのネイティブBannerが残っても二重表示しない。
      if (!state.bannerShown && typeof AdMob.removeBanner === 'function') {
        try { await AdMob.removeBanner(); } catch (_) {}
      }

      if (!state.bannerShown) {
        await AdMob.showBanner({
          adId: PROD_BANNER_ID,
          adSize: 'ADAPTIVE_BANNER',
          position: 'BOTTOM_CENTER',
          margin: 0,
          isTesting: TEST_MODE,
          npa: true,
        });
        state.bannerShown = true;
      } else if (typeof AdMob.resumeBanner === 'function') {
        await AdMob.resumeBanner();
      }

      setPageAdVisible(true);
      // SizeChangedが来るまでの安全な初期余白。
      if (!getComputedStyle(document.documentElement).getPropertyValue('--mixcolor-ad-height').trim()) {
        setCssAdHeight(60);
      }
      return true;
    } catch (e) {
      state.bannerShown = false;
      setPageAdVisible(false);
      console.warn('[MIX COLOR][AdMob] show banner failed:', e);
      return false;
    }
  }

  async function setBannerVisible(visible) {
    state.bannerWanted = !!visible;

    if (!state.initialized) {
      await init();
      if (!state.initialized) return;
    }

    const AdMob = getAdMob();
    if (!AdMob || !state.canRequestAds) {
      setPageAdVisible(false);
      return;
    }

    if (state.bannerWanted) {
      await showBannerInternal();
    } else {
      try {
        if (state.bannerShown && typeof AdMob.hideBanner === 'function') {
          await AdMob.hideBanner();
        }
      } catch (e) {
        console.warn('[MIX COLOR][AdMob] hide banner:', e);
      }
      setPageAdVisible(false);
    }
  }

  async function openPrivacyOptions() {
    const AdMob = getAdMob();
    if (!AdMob) return;

    try {
      if (!state.initialized) await init();
      await AdMob.showPrivacyOptionsForm();

      // フォーム後に同意状態を更新する。
      const consentInfo = await AdMob.requestConsentInfo();
      state.canRequestAds = !!consentInfo?.canRequestAds;
      state.privacyRequired =
        consentInfo?.privacyOptionsRequirementStatus === 'REQUIRED';
      refreshPrivacyButtons();

      if (state.canRequestAds && state.bannerWanted) {
        await showBannerInternal();
      } else if (!state.canRequestAds) {
        await setBannerVisible(false);
      }
    } catch (e) {
      console.warn('[MIX COLOR][AdMob] privacy options:', e);
      alert('広告のプライバシー設定を開けませんでした。時間をおいてもう一度お試しください。');
    }
  }

  function bindPrivacyButton(id) {
    const btn = document.getElementById(id);
    if (!btn) return;

    btn.setAttribute('data-mixcolor-ad-privacy', '');
    btn.style.display = 'none';
    btn.addEventListener('click', () => openPrivacyOptions());
    refreshPrivacyButtons();
  }

  // アプリがバックグラウンドに入る時はネイティブ広告も一時停止。
  document.addEventListener('visibilitychange', () => {
    const AdMob = getAdMob();
    if (!AdMob || !state.bannerShown) return;

    if (document.hidden) {
      if (typeof AdMob.hideBanner === 'function') {
        AdMob.hideBanner().catch(() => {});
      }
      setPageAdVisible(false);
    } else if (state.bannerWanted && state.canRequestAds) {
      showBannerInternal().catch(() => {});
    }
  });

  window.MixColorAds = {
    init,
    setBannerVisible,
    openPrivacyOptions,
    bindPrivacyButton,
    getState: () => ({ ...state, plugin: undefined, initPromise: undefined }),
    isTesting: () => TEST_MODE,
  };
})();
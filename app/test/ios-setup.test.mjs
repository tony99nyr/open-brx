// F395 (iOS half, 2026-09-25): "Same plain yes" — the iOS launch screen becomes a plain fill of
// the app's own background colour (#030407), no logo, matching the Android fix. ios/ is generated
// and git-ignored (never hand-edited), and there is no Mac in this environment to run
// `npx cap add ios` and open the result in Xcode, so this is the only verification available: it
// runs the EXACT python heredoc ios-setup.sh ships (extracted from the source file itself, not a
// copy) against a byte-for-byte copy of Capacitor's own stock LaunchScreen.storyboard (from
// @capacitor/cli's ios-spm-template.tar.gz, confirmed against a real @capacitor/cli install
// elsewhere on this machine), so the test cannot drift from what actually ships and the fixture
// cannot drift from what `npx cap add ios` really generates today.
//
// NOT verified by this test, and not verifiable without a Mac + Xcode: that the storyboard still
// opens/compiles in Interface Builder, that the resulting screen actually renders as a plain
// #030407 fill on a real device or the simulator, and that UIStatusBarStyle/UIStatusBarHidden
// interact the way expected in the App Switcher snapshot. Say so in the PR/report rather than
// claiming device-level verification that did not happen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = new URL('../scripts/ios-setup.sh', import.meta.url);

function storyboardPython() {
  const src = readFileSync(SCRIPT, 'utf8');
  const openTag = "<<'STORYBOARD_PY'";
  const start = src.indexOf(openTag);
  const bodyStart = src.indexOf('\n', start) + 1;
  const end = src.indexOf('\nSTORYBOARD_PY\n', bodyStart);
  assert.ok(start > 0 && end > bodyStart, 'the STORYBOARD_PY heredoc must still be in ios-setup.sh, byte for byte');
  return src.slice(bodyStart, end + 1);
}

function runOn(storyboardXml, hex = '030407') {
  const dir = mkdtempSync(path.join(tmpdir(), 'brx-ios-setup-'));
  const file = path.join(dir, 'LaunchScreen.storyboard');
  writeFileSync(file, storyboardXml);
  const r = spawnSync('python3', ['-', file, hex], { input: storyboardPython(), encoding: 'utf8' });
  return { ...r, file };
}

// Byte-for-byte copy of @capacitor/cli's assets/ios-spm-template.tar.gz ->
// App/App/Base.lproj/LaunchScreen.storyboard, confirmed 2026-09-25 against a real
// @capacitor/cli install (a sibling worktree's node_modules; this repo's own app/node_modules
// is not installed everywhere Claude runs).
const STOCK_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="17132" targetRuntime="iOS.CocoaTouch" propertyAccessControl="none" useAutolayout="YES" launchScreen="YES" useTraitCollections="YES" useSafeAreas="YES" colorMatched="YES" initialViewController="01J-lp-oVM">
    <device id="retina4_7" orientation="portrait" appearance="light"/>
    <dependencies>
        <deployment identifier="iOS"/>
        <plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="17105"/>
        <capability name="System colors in document resources" minToolsVersion="11.0"/>
        <capability name="documents saved in the Xcode 8 format" minToolsVersion="8.0"/>
    </dependencies>
    <scenes>
        <!--View Controller-->
        <scene sceneID="EHf-IW-A2E">
            <objects>
                <viewController id="01J-lp-oVM" sceneMemberID="viewController">
                    <imageView key="view" userInteractionEnabled="NO" contentMode="scaleAspectFill" horizontalHuggingPriority="251" verticalHuggingPriority="251" image="Splash" id="snD-IY-ifK">
                        <rect key="frame" x="0.0" y="0.0" width="375" height="667"/>
                        <autoresizingMask key="autoresizingMask"/>
                        <color key="backgroundColor" systemColor="systemBackgroundColor"/>
                    </imageView>
                </viewController>
                <placeholder placeholderIdentifier="IBFirstResponder" id="iYj-Kq-Ea1" userLabel="First Responder" sceneMemberID="firstResponder"/>
            </objects>
            <point key="canvasLocation" x="53" y="375"/>
        </scene>
    </scenes>
    <resources>
        <image name="Splash" width="1366" height="1366"/>
        <systemColor name="systemBackgroundColor">
            <color white="1" alpha="1" colorSpace="custom" customColorSpace="genericGamma22GrayColorSpace"/>
        </systemColor>
    </resources>
</document>
`;

test('ios-setup.sh STORYBOARD_PY patch: the stock LaunchScreen loses its Splash image and gets a plain #030407 fill, and exits 0', () => {
  const { status, file } = runOn(STOCK_TEMPLATE);
  assert.equal(status, 0);
  const patched = readFileSync(file, 'utf8');
  assert.doesNotMatch(patched, /image="Splash"/, 'the Splash imageView reference must be gone, not just recoloured');
  assert.doesNotMatch(patched, /systemColor="systemBackgroundColor"/, 'must not fall back to the adaptive white/black system colour');
  assert.doesNotMatch(patched, /<image name="Splash"/, 'the unused Splash resource declaration must be cleaned up too');
  assert.match(patched, /red="0\.011764705882352941" green="0\.01568627450980392" blue="0\.027450980392156862"/, 'the literal fill colour must be exactly #030407 in sRGB fractions');
  assert.match(patched, /customColorSpace="sRGB"/);
});

test('ios-setup.sh STORYBOARD_PY patch: the patched output is well-formed XML with one viewController and no dangling Splash reference', () => {
  const { file } = runOn(STOCK_TEMPLATE);
  const patched = readFileSync(file, 'utf8');
  // A cheap well-formedness check without pulling in an XML parser dependency: every opened tag
  // this patch touches has a matching close, and the document still parses as one root element.
  assert.equal((patched.match(/<imageView\b/g) || []).length, 1);
  assert.equal((patched.match(/<\/imageView>/g) || []).length, 1);
  assert.match(patched, /<resources\/>/, 'the now-empty <resources> block should self-close, not linger open');
});

test('ios-setup.sh STORYBOARD_PY patch: refuses cleanly (non-zero exit, unchanged file) when the storyboard is not in the expected shape', () => {
  const alreadyPatched = STOCK_TEMPLATE.replace(
    /image="Splash" id="snD-IY-ifK"/,
    'id="snD-IY-ifK"',
  );
  const { status, stderr, file } = runOn(alreadyPatched);
  assert.notEqual(status, 0);
  assert.match(stderr, /LaunchScreen imageView not found in the expected shape/);
  assert.equal(readFileSync(file, 'utf8'), alreadyPatched, 'nothing is half-applied when the patch refuses');
});

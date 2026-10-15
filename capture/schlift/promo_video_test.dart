// Promo video capture for brensch.com. Not a test of behaviour: it drives the
// real app on the emulator against a backend seeded with SEED_DEMO_USER=demo,
// at a human pace with animations on, while the host films the screen with
// `adb shell screenrecord` (see ../schlift.sh). Every tap draws a ripple so
// the viewer can follow along. Prints `PROMO|<label>` at each beat so the host
// can line the log up with the recording and trim the login off the front.
//
// Lives in the blog repo; schlift.sh copies it into a lift worktree's
// app/integration_test/ next to the support/ helpers it uses.
import 'dart:math' as math;

import 'package:fixnum/fixnum.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:provider/provider.dart';
import 'package:schlift/gen/workout/v1/wearable.pb.dart';
import 'package:schlift/main.dart';
import 'package:schlift/providers/auth_provider.dart';
import 'package:schlift/providers/workout_provider.dart';
import 'package:schlift/services/health_service.dart';
import 'package:schlift/services/notification_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/scenario.dart';

void beat(String label) =>
    debugPrint('PROMO|$label|${DateTime.now().millisecondsSinceEpoch}');

/// Heart rate the way the watch delivers it (see store_shots_test.dart).
Future<void> feedHeartRate(WidgetTester tester, {required int sinceMs}) async {
  final wp = Provider.of<WorkoutProvider>(
    tester.element(find.byType(MaterialApp).first),
    listen: false,
  );
  final workout = wp.activeWorkout;
  if (workout == null) return;
  final nowMs = DateTime.now().millisecondsSinceEpoch;
  final startMs = workout.startTime.toInt() * 1000;
  final samples = <HeartRateSample>[];
  for (var t = math.max(sinceMs, startMs); t <= nowMs; t += 2000) {
    final secs = (t - startMs) / 1000;
    final phase = (secs % 180) / 180;
    final bpm = phase < 0.3
        ? 105 + 40 * (phase / 0.3)
        : 145 - 40 * ((phase - 0.3) / 0.7);
    samples.add(
      HeartRateSample()
        ..sampledAt = Int64(t)
        ..bpm = bpm + math.sin(secs / 7) * 2
        ..availability =
            HeartRateAvailability.HEART_RATE_AVAILABILITY_AVAILABLE,
    );
  }
  wp.ingestWearHeartRateBatch(
    WearSensorBatch()
      ..batchId = 'promo-$sinceMs-$nowMs'
      ..workoutId = workout.id
      ..sentAt = Int64(nowMs)
      ..heartRateSamples.addAll(samples),
  );
}

class Promo {
  Promo(this.s, this.tester, this.binding);
  final Scenario s;
  final WidgetTester tester;
  final LiveTestWidgetsFlutterBinding binding;

  /// Real-time wait with frames flowing, so animations play on camera.
  Future<void> hold(double seconds) async {
    final end = DateTime.now().add(
      Duration(milliseconds: (seconds * 1000).round()),
    );
    while (DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 16));
    }
  }

  /// A white ring that grows and fades at [at], drawn in the root overlay.
  Future<void> ripple(Offset at) async {
    final overlay = tester.state<OverlayState>(find.byType(Overlay).first);
    final entry = OverlayEntry(
      builder: (_) => IgnorePointer(
        child: TweenAnimationBuilder<double>(
          tween: Tween(begin: 0, end: 1),
          duration: const Duration(milliseconds: 650),
          curve: Curves.easeOut,
          builder: (_, v, _) => Stack(
            children: [
              Positioned(
                left: at.dx - 30,
                top: at.dy - 30,
                child: Opacity(
                  opacity: (1 - v).clamp(0, 1) * 0.9,
                  child: Transform.scale(
                    scale: 0.45 + 0.75 * v,
                    child: Container(
                      width: 60,
                      height: 60,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: Colors.white.withValues(alpha: 0.28),
                        border: Border.all(color: Colors.white, width: 2.5),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    overlay.insert(entry);
    await hold(0.22);
    Future<void>.delayed(const Duration(milliseconds: 700), entry.remove);
  }

  int _pointer = 900;

  /// Send [events] as if they came from the screen, not the test. The live
  /// binding paints crosshairs over test-sourced pointers; device-sourced
  /// ones (with shouldPropagateDevicePointerEvents on) reach the app clean.
  void _device(PointerEvent e) => binding.handlePointerEventForSource(
    e,
    source: TestBindingEventSource.device,
  );

  Future<void> press(Offset at) async {
    final finger = TestPointer(_pointer++, PointerDeviceKind.touch);
    await ripple(at);
    _device(finger.down(at));
    await hold(0.07);
    _device(finger.up());
  }

  Future<void> tap(Finder f, {double after = 1.2}) async {
    expect(f, findsWidgets, reason: 'nothing to tap: $f');
    try {
      await tester.ensureVisible(f.first);
    } catch (_) {}
    await hold(0.15);
    await press(tester.getCenter(f.first));
    await hold(after);
  }

  Future<void> tapText(String label, {double after = 1.2}) =>
      tap(find.text(label), after: after);

  Future<void> tapIcon(IconData icon, {double after = 1.0}) =>
      tap(find.byIcon(icon), after: after);

  /// A visible, finger-speed scroll that comes to rest without flinging.
  Future<void> swipe(double dy, {Finder? within, double after = 1.0}) async {
    final target = within ?? find.byType(Scrollable).first;
    final start = tester.getCenter(target.first);
    final finger = TestPointer(_pointer++, PointerDeviceKind.touch);
    final steps = (dy.abs() / 14).clamp(18, 60).round();
    _device(finger.down(start));
    for (var i = 1; i <= steps; i++) {
      // Ease in and out so the finger stops before lifting: no fling.
      final t = i / steps;
      final eased = t * t * (3 - 2 * t);
      await hold(0.016);
      _device(finger.move(start + Offset(0, dy * eased)));
    }
    await hold(0.12);
    _device(finger.up());
    await hold(after);
  }

  Future<void> menuTo(String label) async {
    await tapIcon(Icons.menu, after: 0.9);
    await tapText(label, after: 1.6);
  }
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  // Draw frames as the app asks for them, like a normal run, so animations
  // are smooth on camera rather than only advancing when the test pumps.
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets('promo video', (tester) async {
    final s = Scenario(binding, tester, 'promo');
    final p = Promo(s, tester, binding);
    await s.run(() async {
      // Scenario.launch() minus convertFlutterSurfaceToImage(): that swaps the
      // on-screen surface for an image the screenshot API can read, and
      // screenrecord would film a frozen screen.
      HealthService.suppressPermissionPrompts = true;
      await NotificationService.init(requestPermissions: false);
      await tester.pumpWidget(const SchliftApp());
      await s.settle();
      // Dev login without the login screen's dev field, which only exists in
      // debug builds; this runs in profile mode for smooth, release-like
      // frames. Profile builds still talk to localhost (see main.dart).
      await Provider.of<AuthProvider>(
        tester.element(find.byType(MaterialApp).first),
        listen: false,
      ).testLogin('demo-live');
      await s.settle(seconds: 4);
      if (await s.waitForText('I understand', seconds: 4)) {
        await s.tapText('I understand');
        await s.settle(seconds: 2);
      }
      if (await s.waitForText('SKIP', seconds: 6)) {
        await s.tapText('SKIP');
      }
      if (!await s.waitForText('Start Early', seconds: 20)) {
        await s.mustSee('Start Set', seconds: 5);
      }
      for (var i = 0; i < 6 && s.isVisible('Skip'); i++) {
        if (!s.visibleTexts().any((t) => t == 'Warmup')) break;
        await s.tapText('Skip');
        await s.settle(seconds: 1);
      }
      // The first visit home would open the coach-mark tour over the finale.
      final userId = Provider.of<AuthProvider>(
        tester.element(find.byType(MaterialApp).first),
        listen: false,
      ).userId;
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool('tutorial_seen_v1.$userId', true);
      await feedHeartRate(tester, sinceMs: 0);

      // Off camera, walk every screen the film visits once so Flutter has
      // compiled their shaders and the first menu slide on camera is smooth.
      binding.shouldPropagateDevicePointerEvents = true;
      await p.menuTo('Progress');
      await p.menuTo('History');
      await p.menuTo('Workout');
      await p.tapText('Heart', after: 0.6);
      await p.tapText('Workout', after: 0.6);
      await p.tapIcon(Icons.menu, after: 0.8);
      await p.tapIcon(Icons.close, after: 1.0);
      await p.hold(1.5);
      debugPrint('PROMO|texts|${s.visibleTexts().join(' ¦ ')}');
      await p.hold(2.0); // the host starts screenrecord on the line above

      beat('start');
      await p.hold(2.2);

      // A set: start it, lift, complete it, and the rest timer takes over.
      await p.tapText(
        s.isVisible('Start Early') ? 'Start Early' : 'Start Set',
        after: 2.4,
      );
      await feedHeartRate(
        tester,
        sinceMs: DateTime.now().millisecondsSinceEpoch - 20000,
      );
      beat('set');
      await p.tapText('Complete Set', after: 2.6);
      await feedHeartRate(
        tester,
        sinceMs: DateTime.now().millisecondsSinceEpoch - 20000,
      );
      beat('rest');

      // Heart rate from the watch.
      await p.tapText('Heart', after: 3.0);
      beat('heart');
      await p.tapText('Workout', after: 1.0);

      // Progress, then one lift's chart.
      await p.menuTo('Progress');
      beat('progress');
      await p.hold(1.4);
      await p.swipe(-420, after: 1.0);
      await p.swipe(420, after: 0.6);
      const lifts = ['Bench Press', 'Squat', 'Deadlift', 'Overhead Press'];
      await p.tapText(lifts.firstWhere(s.isVisible), after: 2.8);
      beat('detail');
      await p.swipe(-260, after: 1.4);

      // History.
      await p.menuTo('History');
      beat('history');
      await p.hold(1.4);
      await p.swipe(-380, after: 1.2);

      // Back to the session and finish it: the summary, then home.
      await p.menuTo('Workout');
      beat('back');
      await p.swipe(-900, after: 0.8);
      await p.tapText('End workout', after: 1.2);
      debugPrint('PROMO|texts|${s.visibleTexts().join(' ¦ ')}');
      await p.tapText('End Workout', after: 3.0);
      beat('summary');
      debugPrint('PROMO|texts|${s.visibleTexts().join(' ¦ ')}');
      await p.swipe(-500, after: 1.4);

      // Home: the muscle tracker and today's suggestion. Start it, which
      // lands on a workout screen again so the loop closes.
      await p.tapIcon(Icons.arrow_back, after: 2.6);
      beat('home');
      debugPrint('PROMO|texts|${s.visibleTexts().join(' ¦ ')}');
      await p.tap(find.text('START').first, after: 2.4);
      beat('end');
      binding.shouldPropagateDevicePointerEvents = false;
    });
  });
}

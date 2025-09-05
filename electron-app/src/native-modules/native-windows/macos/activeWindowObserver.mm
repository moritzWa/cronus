#import "activeWindowObserver.h"
#import "sleepAndLockObserver.h"
#import "browserTabUtils.h"
#import "browserTabTracking.h"
#import "contentExtractor.h"
#import "iconUtils.h"
#import "appFilter.h"
#import "titleExtractor.h"
#include <iostream>
#include <stdio.h> // For fprintf, stderr
#include <stdarg.h>
#import <CoreGraphics/CoreGraphics.h>
#import <os/log.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Cocoa/Cocoa.h>
#import <Vision/Vision.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>  

// Custom Log Macro
#define MyLog(format, ...) { \
    static os_log_t log_handle = NULL; \
    if (log_handle == NULL) { \
        log_handle = os_log_create("com.cronus.app", "ActiveWindowObserver"); \
    } \
    NSString *log_message = [NSString stringWithFormat:format, ##__VA_ARGS__]; \
    os_log(log_handle, "%{public}s", [log_message UTF8String]); \
}

Napi::ThreadSafeFunction activeWindowChangedCallback;
ActiveWindowObserver *windowObserver;
BOOL isObserverStopped = NO;  

auto napiCallback = [](Napi::Env env, Napi::Function jsCallback, std::string* data) {
    jsCallback.Call({Napi::String::New(env, *data)});
    delete data;
};

void windowChangeCallback(AXObserverRef observer, AXUIElementRef element, CFStringRef notificationName, void *refCon) {
    if (CFStringCompare(notificationName, kAXMainWindowChangedNotification, 0) == kCFCompareEqualTo) {
        NSTimeInterval delayInMSec = 30;
        dispatch_time_t popTime = dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delayInMSec * NSEC_PER_MSEC));
        dispatch_after(popTime, dispatch_get_main_queue(), ^(void){
            // CHECK: Don't process if callback is destroyed
            if (!activeWindowChangedCallback) {
                return;
            }
            
            MyLog(@"mainWindowChanged");
            NSDictionary *details = [(__bridge ActiveWindowObserver*)(refCon) getActiveWindow];
            if (details) {
                NSError *error;
                NSData *jsonData = [NSJSONSerialization dataWithJSONObject:details options:0 error:&error];
                if (!jsonData) {
                    MyLog(@"Error creating JSON data in windowChangeCallback: %@", error);
                } else {
                    NSString *jsonString = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
                    std::string* result = new std::string([jsonString UTF8String]);
                    
                    // SAFETY CHECK: Verify callback still exists before calling
                    if (activeWindowChangedCallback) {
                        activeWindowChangedCallback.BlockingCall(result, napiCallback);
                    } else {
                        MyLog(@"⚠️ Callback destroyed during processing, skipping send");
                        delete result; 
                    }
                }
            }
            // Trigger screenshot capture and OCR
            ScreenshotManager *screenshotManager = [[ScreenshotManager alloc] init];
            [screenshotManager takeScreenshot];
            [screenshotManager release];
        });
    }
}

@implementation ActiveWindowObserver {
    NSNumber *processId;
    AXObserverRef observer;
    NSTimer *periodicCheckTimer;          
    NSString *lastTrackedApp;             
    NSTimeInterval lastAppSwitchTime;    
    BOOL isCurrentlyTracking;           
    BrowserTabTracking *browserTabTracking;
    SleepAndLockObserver *sleepAndLockObserver;
}

- (id)init {
    self = [super init];
    if (!self) return nil;
    
    sleepAndLockObserver = [[SleepAndLockObserver alloc] initWithWindowObserver:self];
    browserTabTracking = [[BrowserTabTracking alloc] init];
    browserTabTracking.delegate = self;
    
    // Get both workspace and distributed notification centers
    NSNotificationCenter *workspaceCenter = [[NSWorkspace sharedWorkspace] notificationCenter];
    
    // Workspace notifications (sleep/wake)
    [workspaceCenter addObserver:self 
                        selector:@selector(receiveAppChangeNotification:) 
                            name:NSWorkspaceDidActivateApplicationNotification 
                          object:nil];
    
    MyLog(@"🔧 DEBUG: Initialized observers for sleep/wake and lock/unlock events");
    
    return self;
}

- (void)dealloc {
    [browserTabTracking release];
    browserTabTracking = nil;
    [sleepAndLockObserver release];
    sleepAndLockObserver = nil;

    [[[NSWorkspace sharedWorkspace] notificationCenter] removeObserver:self];
    [[NSDistributedNotificationCenter defaultCenter] removeObserver:self];
    [super dealloc];
}

// periodic backup timer
- (void)startPeriodicBackupTimer {
    [self stopPeriodicBackupTimer];
    
    // Check every 5 minutes as backup 
    periodicCheckTimer = [NSTimer scheduledTimerWithTimeInterval:300.0  
                                                        target:self
                                                      selector:@selector(periodicBackupCheck)
                                                      userInfo:nil
                                                       repeats:YES];
    [[NSRunLoop currentRunLoop] addTimer:periodicCheckTimer forMode:NSRunLoopCommonModes];
    MyLog(@"📅 Periodic backup timer started (5 min intervals)");
}

- (void)stopPeriodicBackupTimer {
    [periodicCheckTimer invalidate];
    periodicCheckTimer = nil;
    MyLog(@"📅 Periodic backup timer stopped");
}

// Backup check (only if user hasn't switched apps recently)
- (void)periodicBackupCheck {
    NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
    NSTimeInterval timeSinceLastSwitch = now - lastAppSwitchTime;
    
    // MyLog(@"⏰ PERIODIC TIMER FIRED - Last switch: %.1f seconds ago", timeSinceLastSwitch);
    
    // Always capture periodic backup
    // MyLog(@"📅 PERIODIC BACKUP: Capturing current state");
    
    NSDictionary *windowInfo = [self getActiveWindow];
    if (windowInfo) {
        NSString *currentApp = windowInfo[@"ownerName"];
        MyLog(@"📅 BACKUP CAPTURE: %@", currentApp);
        [self sendWindowInfoToJS:windowInfo withReason:@"periodic_backup"];
        lastTrackedApp = currentApp;
    }
}

- (void) receiveAppChangeNotification:(NSNotification *) notification {
    [self removeWindowObserver];

    int currentAppPid = [NSProcessInfo processInfo].processIdentifier;
    NSDictionary<NSString*, NSRunningApplication*> *userInfo = [notification userInfo];
    NSNumber *selectedProcessId = [userInfo valueForKeyPath:@"NSWorkspaceApplicationKey.processIdentifier"];

    if (processId != nil && selectedProcessId.intValue == currentAppPid) {
        return;
    }

    processId = selectedProcessId;
    
    // 🎯 NEW: Track app switch timing
    lastAppSwitchTime = [[NSDate date] timeIntervalSince1970];

    // Capture the PID for this specific operation before the async block.
    NSNumber *currentOperationProcessId = self->processId; 
    NSRunningApplication *appBeforeDelay = [NSRunningApplication runningApplicationWithProcessIdentifier:currentOperationProcessId.intValue];
    NSString *expectedAppNameBeforeDelay = appBeforeDelay ? appBeforeDelay.localizedName : @"Unknown (PID lookup failed)";

    // MyLog(@"[AppSwitch] Notification for app activation: %@ (PID %@)", expectedAppNameBeforeDelay, currentOperationProcessId);

    // After an app activation notification, there can be a slight delay before the system
    // fully updates its window list. Introduce a brief pause here to ensure that when
    // we query for the active window, we get the newly activated app, not the previous one.
    // Introduce a small delay to allow system window state to update
    NSTimeInterval delayInMSec = 100;
    dispatch_time_t popTime = dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delayInMSec * NSEC_PER_MSEC));
    
    dispatch_after(popTime, dispatch_get_main_queue(), ^(void){
        // MyLog(@"[AppSwitch] After %.0fms delay, processing for PID %@", delayInMSec, currentOperationProcessId);
        NSDictionary *details = [self getActiveWindow]; // Attempt to get the new active window
        
        if (details) {
            NSString *ownerNameFromDetails = details[@"ownerName"];
            // MyLog(@"[AppSwitch]   Active window found: %@. Expected app: %@.", ownerNameFromDetails, expectedAppNameBeforeDelay);
            
            // Update tracking variables and send data
            self->lastTrackedApp = ownerNameFromDetails;
            [self sendWindowInfoToJS:details withReason:@"app_switch"];
        } else {
            //  MyLog(@"[AppSwitch]   No active window details found after delay for PID: %@", currentOperationProcessId);
        }

        // Setup observer for the new application
        AXUIElementRef appElem = AXUIElementCreateApplication(currentOperationProcessId.intValue);
        if (!appElem) {
            // MyLog(@"[AppSwitch]   Failed to create AXUIElement for PID %@", currentOperationProcessId);
            return;
        }
        
        // self->observer should be Nil here due to [self removeWindowObserver] at the start of receiveAppChangeNotification
        AXError createResult = AXObserverCreate(currentOperationProcessId.intValue, windowChangeCallback, &(self->observer));

        if (createResult != kAXErrorSuccess) {
            // MyLog(@"[AppSwitch]   AXObserverCreate failed for PID %@: Error %d", currentOperationProcessId, createResult);
            CFRelease(appElem); // Release appElem if observer creation fails
            return;
        }

        AXObserverAddNotification(self->observer, appElem, kAXMainWindowChangedNotification, (__bridge void *)(self));
        CFRunLoopAddSource([[NSRunLoop currentRunLoop] getCFRunLoop], AXObserverGetRunLoopSource(self->observer), kCFRunLoopDefaultMode);
        
        CFRelease(appElem); // Release the element as its information has been registered
        // MyLog(@"[AppSwitch]   Observers added for PID %@ (%@)", currentOperationProcessId, expectedAppNameBeforeDelay);
    });
}

// Centralized method to send data to JavaScript
- (void)sendWindowInfoToJS:(NSDictionary*)windowInfo withReason:(NSString*)reason {
    // CHECK: Don't send if callback is destroyed
    if (!activeWindowChangedCallback) {
        return;
    }
    
    NSMutableDictionary *enrichedInfo = [windowInfo mutableCopy];
    enrichedInfo[@"captureReason"] = reason;
    enrichedInfo[@"timestamp"] = @([[NSDate date] timeIntervalSince1970] * 1000);
    
    // Check content size before JSON serialization
    NSString *content = enrichedInfo[@"content"];
    if (content && content.length > 2000) {
        MyLog(@"⚠️ Content too large for JSON (%lu chars), truncating", (unsigned long)content.length);
        enrichedInfo[@"content"] = [content substringToIndex:2000];
    }
    
     @try {
        NSError *error;
        NSData *jsonData = [NSJSONSerialization dataWithJSONObject:enrichedInfo options:0 error:&error];
        if (!jsonData) {
            MyLog(@"❌ JSON serialization failed: %@", error);
            return;
        }
        
        NSString *jsonString = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
        if (!jsonString) {
            MyLog(@"❌ Failed to create JSON string");
            return;
        }
        
        std::string* result = new std::string([jsonString UTF8String]);
        
        // Verify callback still exists before calling
        if (activeWindowChangedCallback) {
            activeWindowChangedCallback.BlockingCall(result, napiCallback);
        } else {
            delete result; 
        }
        
    } @catch (NSException *exception) {
        MyLog(@"💥 FATAL: sendWindowInfoToJS crashed: %@", [exception reason]);
    }
}

- (NSDictionary*)getActiveWindow {
    NSArray *windows = (__bridge NSArray *)CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID);
    NSDictionary *frontmostWindow = nil;

    for (NSDictionary *window in windows) {
        NSNumber *windowLayer = [window objectForKey:(id)kCGWindowLayer];
        if ([windowLayer intValue] == 0) { 
            // Add a check to ignore tiling manager windows
            NSString *windowOwnerName = [window objectForKey:(id)kCGWindowOwnerName];
            NSString *windowTitle = [window objectForKey:(id)kCGWindowName];
            if ([windowOwnerName isEqualToString:@"WindowManager"] && [windowTitle isEqualToString:@"Tiling Handle Window"]) {
                MyLog(@"[Filter] Ignoring tiling manager helper window.");
                continue; // This is the helper window, skip it and check the next one.
            }

            frontmostWindow = window;
            break;
        }
    }

    if (frontmostWindow) {
        NSNumber *windowNumber = [frontmostWindow objectForKey:(id)kCGWindowNumber];
        NSString *windowOwnerName = [frontmostWindow objectForKey:(id)kCGWindowOwnerName];
        NSString *windowTitle = [frontmostWindow objectForKey:(id)kCGWindowName];
        CGWindowID windowId = [windowNumber unsignedIntValue];

        // filter out specific apps 
        if (shouldExcludeApp(windowOwnerName, windowTitle)) {
            return nil;
        }
        
        NSString *iconPath = getAppIconPath(windowOwnerName);
        
        // Create base window info
        NSMutableDictionary *windowInfo = [@{
            @"id": windowNumber,
            @"ownerName": windowOwnerName ? windowOwnerName : @"Unknown",
            @"title": windowTitle ? windowTitle : @"",
            @"type": @"window",
            @"icon": iconPath ? iconPath : @"",
            @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
        } mutableCopy];

        // If we don't have a window title, try to get it using our title extractor
        if (!windowTitle || windowTitle.length == 0) {
            NSString *extractedTitle = [TitleExtractor extractWindowTitleForApp:windowOwnerName];
            if (extractedTitle && extractedTitle.length > 0) {
                windowInfo[@"title"] = extractedTitle;
                MyLog(@"   ✅ Title extracted successfully: '%@'", extractedTitle);
            } else {
                MyLog(@"   ⚠️  Could not extract title for app: %@", windowOwnerName);
            }
        }

        MyLog(@"🔍 ACTIVE WINDOW CHANGED:");
        MyLog(@"   Owner: %@", windowOwnerName);
        MyLog(@"   Title: %@", windowTitle);
        MyLog(@"   Type: %@", windowInfo[@"type"]);
        
        // --- Start Browser Tab Timer Management ---
        BOOL isChrome = [windowOwnerName isEqualToString:@"Google Chrome"];
        BOOL isArc = [windowOwnerName isEqualToString:@"Arc"];

        if (isChrome || isArc) {
            NSString *activeBrowserName = isChrome ? @"Google Chrome" : @"Arc";
            if (!browserTabTracking.isBrowserActive || ![browserTabTracking.browserName isEqualToString:activeBrowserName]) {
                MyLog(@"[Browser Tab] %@ became active. Initializing tab tracking.", activeBrowserName);
                if (browserTabTracking.isBrowserActive) {
                    [browserTabTracking stopBrowserTabTimer];
                }
                browserTabTracking.browserName = activeBrowserName;
                browserTabTracking.isBrowserActive = YES;
                [browserTabTracking startBrowserTabTimer];
            }
        } else {
            if (browserTabTracking.isBrowserActive) {
                MyLog(@"[Browser Tab] %@ no longer active.", browserTabTracking.browserName);
                browserTabTracking.isBrowserActive = NO;
                [browserTabTracking stopBrowserTabTimer];
                browserTabTracking.lastKnownBrowserURL = nil;
                browserTabTracking.lastKnownBrowserTitle = nil;
                browserTabTracking.browserName = nil;
            }
        }
        // --- End Browser Tab Timer Management ---
        
        //  NEW: Universal immediate OCR for ALL apps
        if ([windowOwnerName isEqualToString:@"Google Chrome"]) {
            MyLog(@"🔍 Chrome window detected - getting URL/title + immediate OCR");
            
            NSDictionary *chromeInfo = [BrowserTabUtils getChromeTabInfo];
            if (chromeInfo) {
                windowInfo[@"url"] = chromeInfo[@"url"];
                windowInfo[@"title"] = chromeInfo[@"title"] ?: windowInfo[@"title"];
                windowInfo[@"type"] = @"browser";
                windowInfo[@"browser"] = @"chrome";

                if (browserTabTracking.isBrowserActive && browserTabTracking.lastKnownBrowserURL == nil && chromeInfo[@"url"]) {
                    MyLog(@"[Browser Tab] Setting initial known tab for Chrome: URL=%@, Title=%@", chromeInfo[@"url"], chromeInfo[@"title"]);
                    browserTabTracking.lastKnownBrowserURL = [chromeInfo[@"url"] copy];
                    browserTabTracking.lastKnownBrowserTitle = [chromeInfo[@"title"] copy];
                }
            }
            
            // 🛡️ PROTECTED OCR
            @try {
                NSString *ocrContent = [self captureScreenshotAndPerformOCR:windowId];
                windowInfo[@"content"] = ocrContent ?: @"";
                windowInfo[@"contentSource"] = @"ocr";
                MyLog(@"✅ Chrome OCR completed: %lu characters", (unsigned long)[ocrContent length]);
            } @catch (NSException *exception) {
                MyLog(@"💥 Chrome OCR crashed: %@", [exception reason]);
                windowInfo[@"content"] = @"";
                windowInfo[@"contentSource"] = @"ocr_failed";
            }
            
        } else if ([windowOwnerName isEqualToString:@"Arc"]) {
            MyLog(@"🔍 Arc window detected - getting URL/title + immediate OCR");
            
            NSDictionary *arcInfo = [BrowserTabUtils getArcTabInfo];
            if (arcInfo) {
                windowInfo[@"url"] = arcInfo[@"url"];
                windowInfo[@"title"] = arcInfo[@"title"] ?: windowInfo[@"title"];
                windowInfo[@"type"] = @"browser";
                windowInfo[@"browser"] = @"arc";

                if (browserTabTracking.isBrowserActive && browserTabTracking.lastKnownBrowserURL == nil && arcInfo[@"url"]) {
                    MyLog(@"[Browser Tab] Setting initial known tab for Arc: URL=%@, Title=%@", arcInfo[@"url"], arcInfo[@"title"]);
                    browserTabTracking.lastKnownBrowserURL = [arcInfo[@"url"] copy];
                    browserTabTracking.lastKnownBrowserTitle = [arcInfo[@"title"] copy];
                }
            }
            
            @try {
                NSString *ocrContent = [self captureScreenshotAndPerformOCR:windowId];
                windowInfo[@"content"] = ocrContent ?: @"";
                windowInfo[@"contentSource"] = @"ocr";
                MyLog(@"✅ Arc OCR completed: %lu characters", (unsigned long)[ocrContent length]);
            } @catch (NSException *exception) {
                MyLog(@"💥 Arc OCR crashed: %@", [exception reason]);
                windowInfo[@"content"] = @"";
                windowInfo[@"contentSource"] = @"ocr_failed";
            }
            
        } else if ([windowOwnerName isEqualToString:@"Safari"]) {
            MyLog(@"🔍 Safari window detected - getting URL/title + immediate OCR");
            
            NSDictionary *safariInfo = [BrowserTabUtils getSafariTabInfo];
            if (safariInfo) {
                windowInfo[@"url"] = safariInfo[@"url"];
                windowInfo[@"title"] = safariInfo[@"title"] ?: windowInfo[@"title"];
                windowInfo[@"type"] = @"browser";
                windowInfo[@"browser"] = @"safari";
            }
            
            @try {
                NSString *ocrContent = [self captureScreenshotAndPerformOCR:windowId];
                windowInfo[@"content"] = ocrContent ?: @"";
                windowInfo[@"contentSource"] = @"ocr";
                MyLog(@"✅ Safari OCR completed: %lu characters", (unsigned long)[ocrContent length]);
            } @catch (NSException *exception) {
                MyLog(@"💥 Safari OCR crashed: %@", [exception reason]);
                windowInfo[@"content"] = @"";
                windowInfo[@"contentSource"] = @"ocr_failed";
            }
            
        } else {
            MyLog(@"🔍 Non-browser app: %@ - trying accessibility + OCR fallback", windowOwnerName);
            
            NSString *extractedText = [ContentExtractor getAppTextContent:windowOwnerName windowId:windowId];
            if (extractedText && extractedText.length > 0) {
                windowInfo[@"content"] = extractedText;
                windowInfo[@"contentSource"] = @"accessibility";
                MyLog(@"✅ Accessibility extraction: %lu characters", (unsigned long)[extractedText length]);
            } else {
                @try {
                    NSString *ocrContent = [self captureScreenshotAndPerformOCR:windowId];
                    
                    // 🛡️ MEMORY PROTECTION: Limit OCR content size
                    if (ocrContent && ocrContent.length > 2000) {
                        MyLog(@"⚠️ OCR content too large (%lu chars), truncating to 3000", (unsigned long)ocrContent.length);
                        ocrContent = [ocrContent substringToIndex:2000];
                    }
                    
                    windowInfo[@"content"] = ocrContent ?: @"";
                    windowInfo[@"contentSource"] = @"ocr";
                    MyLog(@"✅ Non-browser OCR completed: %lu characters for %@", (unsigned long)[ocrContent length], windowOwnerName);
                } @catch (NSException *exception) {
                    MyLog(@"💥 Non-browser OCR crashed for %@: %@", windowOwnerName, [exception reason]);
                    windowInfo[@"content"] = @"";
                    windowInfo[@"contentSource"] = @"ocr_failed";
                }
            }
        }

        return windowInfo;
    }
    return nil;
}

- (void) removeWindowObserver
{
    if (observer != Nil) {
        CFRunLoopRemoveSource([[NSRunLoop currentRunLoop] getCFRunLoop], AXObserverGetRunLoopSource(observer), kCFRunLoopDefaultMode);
        CFRelease(observer);
        observer = Nil;
    }
}

- (void)cleanUp {
    [self stopPeriodicBackupTimer];    
    [browserTabTracking stopBrowserTabTimer];
    [sleepAndLockObserver stopObserving];
    [[[NSWorkspace sharedWorkspace] notificationCenter] removeObserver:self];
    [self removeWindowObserver];
}

// App exclusion related - REMOVED, see appFilter.mm

- (void)browserTabDidSwitch:(NSDictionary *)newTabInfo {
    MyLog(@"   Delegate received tab switch. Sending full details for new tab state (Owner: %@, Title: %@, URL: %@)", 
          newTabInfo[@"ownerName"], 
          newTabInfo[@"title"],
          newTabInfo[@"url"]);
    [self sendWindowInfoToJS:newTabInfo withReason:@"browser_tab_switch"];
}

#pragma mark - Unified Screenshot + OCR Methods

// 🆕 NEW: Unified screenshot + OCR methods
- (NSString*)captureScreenshotAndPerformOCR:(CGWindowID)windowId {
    // Don't perform OCR if observer is stopped
    if (isObserverStopped) {
        NSLog(@"⚠️ Observer stopped, skipping OCR for window %u", windowId);
        return @"";
    }
    
    MyLog(@"🔍 Starting screenshot + OCR for window ID: %u", windowId);
    
    @try {
        CGImageRef screenshot;
        
        if (windowId == 0) {
            screenshot = CGWindowListCreateImage(CGRectInfinite,
                                               kCGWindowListOptionOnScreenOnly,
                                               kCGNullWindowID,
                                               kCGWindowImageDefault);
        } else {
            screenshot = CGWindowListCreateImage(CGRectNull,
                                               kCGWindowListOptionIncludingWindow,
                                               windowId,
                                               kCGWindowImageBoundsIgnoreFraming | kCGWindowImageNominalResolution);
        }
        
        if (!screenshot) {
            MyLog(@"❌ Failed to capture screenshot for window %u", windowId);
            return @"";
        }
        
        // Perform OCR using Vision framework
        NSTimeInterval startTime = [[NSDate date] timeIntervalSince1970];
        
        VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
        request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
        request.usesLanguageCorrection = NO;
        
        VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] 
            initWithCGImage:screenshot options:@{}];
        
        NSError *error = nil;
        BOOL success = [handler performRequests:@[request] error:&error];
        
        NSTimeInterval ocrDuration = ([[NSDate date] timeIntervalSince1970] - startTime) * 1000;
        MyLog(@"🚀 OCR completed in %.1fms (langCorrection=NO)", ocrDuration);
        
        NSString *result = @"";
        if (success && !error) {
            NSMutableArray *textSegments = [[NSMutableArray alloc] init];
            
            for (VNRecognizedTextObservation *observation in request.results) {
                VNRecognizedText *topCandidate = [observation topCandidates:1].firstObject;
                if (topCandidate && topCandidate.confidence > 0.3) {
                    [textSegments addObject:topCandidate.string];
                }
            }
            
            result = [textSegments componentsJoinedByString:@" "];
            MyLog(@"✅ OCR completed: %lu characters for window %u", (unsigned long)result.length, windowId);
            [textSegments release];
        } else {
            MyLog(@"❌ OCR failed for window %u: %@", windowId, error ? [error description] : @"Unknown error");
        }
        
        [request release];
        [handler release];
        CFRelease(screenshot);
        
        return result;
        
    } @catch (NSException *exception) {
        MyLog(@"💥 Exception in OCR: %@", [exception reason]);
        return @"";
    }
}

// Method for current window (used by renderer requests)
- (NSDictionary*)captureScreenshotAndOCRForCurrentWindow {
    MyLog(@"📱 Renderer requested screenshot + OCR for current window");
    
    NSDictionary *windowInfo = [self getActiveWindow];
    if (!windowInfo) {
        MyLog(@"❌ No active window found for OCR request");
        return @{@"success": @NO, @"error": @"No active window"};
    }
    
    CGWindowID windowId = [[windowInfo objectForKey:@"id"] unsignedIntValue];
    NSString *ocrText = [self captureScreenshotAndPerformOCR:windowId];
    
    MyLog(@"✅ OCR request completed: %lu characters extracted", (unsigned long)[ocrText length]);
    
    return @{
        @"success": @YES,
        @"ocrText": ocrText ?: @"",
        @"windowInfo": windowInfo
    };
}

@end

void initActiveWindowObserver(Napi::Env env, Napi::Function windowCallback) {
    isObserverStopped = NO;  // Reset the flag
    activeWindowChangedCallback = Napi::ThreadSafeFunction::New(env, windowCallback, "ActiveWindowChanged", 0, 1);
    windowObserver = [[ActiveWindowObserver alloc] init];
}

void stopActiveWindowObserver(Napi::Env env) {
    isObserverStopped = YES;
    
    if (windowObserver) {
        [windowObserver cleanUp];
        [windowObserver release];
        windowObserver = Nil;
    }
    
    if (activeWindowChangedCallback) {
        activeWindowChangedCallback.Abort();
        activeWindowChangedCallback = Nil;
    }
}
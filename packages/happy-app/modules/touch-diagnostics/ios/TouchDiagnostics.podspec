Pod::Spec.new do |s|
  s.name           = 'TouchDiagnostics'
  s.version        = '1.0.0'
  s.summary        = 'Records which views and gesture recognizers receive each touch, for diagnosing swallowed taps.'
  s.description    = 'Keeps a short in-memory log of touches, keyboard, text input and window events, and exports it with a snapshot of the windows and the first responder.'
  s.license        = 'MIT'
  s.author         = 'happy-next'
  s.homepage       = 'https://github.com/kuaifan/happy-next'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
end

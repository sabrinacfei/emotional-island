Pod::Spec.new do |s|
  s.name           = 'OnDeviceDiagnostics'
  s.version        = '0.1.0'
  s.summary        = 'Local model integrity and measured iPhone process footprint'
  s.description    = 'Streams SHA-256 and samples this process; does not transmit diaries.'
  s.license        = { :type => 'MIT' }
  s.author         = 'Emotion Diary Research'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.frameworks = 'CoreML'
  s.resource_bundles = { 'ModernBERTAssets' => ['Assets/ModernBERT.mlmodelc', 'Assets/modernbert-tokenizer.json', 'Assets/modernbert-manifest.json'] }
end

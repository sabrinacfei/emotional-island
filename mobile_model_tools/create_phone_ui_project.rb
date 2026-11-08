require 'xcodeproj'
integration=File.expand_path('..',__dir__)
root=File.basename(integration)=='app_integration' ? File.dirname(integration) : integration
work=File.join(root,'.mobile_modernbert_work_20261108')
project=Xcodeproj::Project.new(File.join(work,'PhoneClassifierAcceptance.xcodeproj'))
target=project.new_target(:ui_test_bundle,'PhoneClassifierAcceptance',:ios,'15.1')
group=project.main_group.new_group('SyntheticTests')
target.source_build_phase.add_file_reference(group.new_file(File.join(__dir__,'PhoneClassifierAcceptance.swift')))
native=File.join(integration,'EmotionApp2/modules/on-device-diagnostics/ios')
target.source_build_phase.add_file_reference(group.new_file(File.join(native,'ModernBERTCore.swift')))
assets=group.new_file(File.join(native,'Assets'));assets.last_known_file_type='folder'
target.resources_build_phase.add_file_reference(assets)
tokens=group.new_file(File.join(work,'tokenizer-fixtures.json'));target.resources_build_phase.add_file_reference(tokens)
resource=group.new_file(File.join(work,'phone-credentials.json'));target.resources_build_phase.add_file_reference(resource)
reference=group.new_file(File.join(work,'phone-reference.json'));target.resources_build_phase.add_file_reference(reference)
target.build_configurations.each do |config|
 config.build_settings.merge!({'PRODUCT_BUNDLE_IDENTIFIER'=>'tw.sabrina.emotionalisland.acceptance','DEVELOPMENT_TEAM'=>'66JK6AR32K',
   'CODE_SIGN_STYLE'=>'Automatic','GENERATE_INFOPLIST_FILE'=>'YES','SWIFT_VERSION'=>'5.0','TARGETED_DEVICE_FAMILY'=>'1','TEST_TARGET_NAME'=>'',
   'DEBUG_INFORMATION_FORMAT'=>'dwarf'})
end
project.save
scheme=Xcodeproj::XCScheme.new;scheme.add_build_target(target);scheme.add_test_target(target)
scheme.test_action.build_configuration='Release';scheme.save_as(project.path,'PhoneClassifierAcceptance',true)
puts 'Created isolated native UI acceptance project'

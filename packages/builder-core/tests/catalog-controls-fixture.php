<?php
define( 'ABSPATH', __DIR__ . '/' );
class WP_Error { public function __construct( ...$args ) {} }
function is_wp_error( $value ) { return $value instanceof WP_Error; }
function wp_json_encode( $value ) { return json_encode( $value ); }
function get_option( $key, $default = false ) { return $GLOBALS['options'][$key] ?? $default; }
function update_option( $key, $value, ...$args ) { $GLOBALS['options'][$key] = $value; return true; }
function add_option( $key, $value, ...$args ) { if ( isset( $GLOBALS['options'][$key] ) ) return false; return update_option( $key, $value ); }
function delete_option( $key ) { unset( $GLOBALS['options'][$key] ); }
function wp_generate_uuid4() { return 'fixture-lock'; }
function get_posts() { return array(); }
function get_post_stati() { return array( 'inherit' => 'inherit' ); }
function check( $condition ) { if ( ! $condition ) throw new RuntimeException( 'Catalog control assertion failed' ); }
require __DIR__ . '/../../../wordpress/bootstrap/sample-content-installer.php';
$root = $argv[1]; mkdir( $root . '/sample-assets' ); file_put_contents( $root . '/sample-assets/asset-test.png', 'x' );
$payload = array( 'schemaVersion' => 1, 'content' => array(), 'terms' => array(), 'attributes' => array(), 'assets' => array( array( 'id' => 'asset-test', 'kind' => 'image', 'file' => 'sample-assets/asset-test.png', 'size' => 1, 'sha256' => hash( 'sha256', 'x' ) ) ) );
$fingerprint = hash( 'sha256', wp_json_encode( $payload ) );
$GLOBALS['options'] = array( 'mms_wp_starter_sample_progress' => array( 'phase' => 'assets', 'index' => 0, 'fingerprint' => $fingerprint ), 'mms_wp_starter_catalog_choice' => array( 'skipImages' => true, 'fingerprint' => $fingerprint ) );
$installer = new MMS_WP_Starter_Sample_Content( $payload, $root );
check( false === $installer->step() );
check( get_option( 'mms_wp_starter_sample_progress' )['phase'] === 'content' );
$method = new ReflectionMethod( $installer, 'attachment_id' ); $method->setAccessible( true );
check( 0 === $method->invoke( $installer, 'asset-test' ) );
check( is_wp_error( $method->invoke( $installer, 'unrelated' ) ) );
update_option( 'mms_wp_starter_catalog_choice', array( 'skipImages' => true, 'fingerprint' => 'different-build' ) );
check( is_wp_error( $method->invoke( $installer, 'asset-test' ) ) );
update_option( 'mms_wp_starter_catalog_choice', array( 'stop' => true, 'fingerprint' => $fingerprint ) );
$checkpoint = get_option( 'mms_wp_starter_sample_progress' );
check( true === $installer->step() ); check( get_option( 'mms_wp_starter_sample_progress' ) === $checkpoint );
check( ! get_option( 'mms_wp_starter_sample_lock' ) );
echo "PASS native image bypass, fingerprint scope, strict missing references and stop preservation\n";

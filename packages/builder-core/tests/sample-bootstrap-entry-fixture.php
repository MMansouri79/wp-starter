<?php
// Invoked in separate PHP processes to simulate real bootstrap admin requests.
$workspace = $argv[1];
define( 'ABSPATH', $workspace . '/' );
define( 'WP_CONTENT_DIR', $workspace . '/wp-content' );
define( 'WPMU_PLUGIN_DIR', WP_CONTENT_DIR . '/mu-plugins' );
$state_file = $workspace . '/options.json';
$GLOBALS['options'] = json_decode( file_get_contents( $state_file ), true );
class WP_Error { private $message; public function __construct( $code, $message ) { $this->message = $message; } public function get_error_message() { return $this->message; } }
function is_wp_error( $v ) { return $v instanceof WP_Error; }
function get_option( $key, $default = false ) { return $GLOBALS['options'][$key] ?? $default; }
function persist() { global $state_file; file_put_contents( $state_file, json_encode( $GLOBALS['options'] ) ); }
function update_option( $key, $value, $autoload = null ) { $GLOBALS['options'][$key] = $value; persist(); return true; }
function add_option( $key, $value, $deprecated = '', $autoload = false ) { if ( isset( $GLOBALS['options'][$key] ) ) return false; return update_option( $key, $value ); }
function delete_option( $key ) { unset( $GLOBALS['options'][$key] ); persist(); }
function add_action() {}
function wp_installing() { return false; }
function is_admin() { return true; }
function current_user_can() { return true; }
function absint( $v ) { return abs( (int) $v ); }
function check_admin_referer() {}
function wp_safe_redirect() { persist(); }
function admin_url( $path = '' ) { return 'http://localhost/' . $path; }
function add_query_arg( $args, $url ) { return $url . '?' . http_build_query( $args ); }
function wp_nonce_url( $url ) { return $url; }
function wp_json_encode( $v ) { return json_encode( $v ); }
function wp_generate_uuid4() { return uniqid( 'lock-', true ); }
function sanitize_key( $v ) { return $v; }
function sanitize_title( $v ) { return $v; }
function sanitize_text_field( $v ) { return $v; }
function wp_kses_post( $v ) { return $v; }
function wp_slash( $v ) { return $v; }
function wp_unslash( $v ) { return $v; }
function get_current_user_id() { return 1; }
function get_post_stati() { return array( 'draft' => 'draft', 'publish' => 'publish' ); }
function get_posts( $args ) { $post = get_option( 'fixture_post' ); return $post && $post['sample_id'] === $args['meta_value'] ? array( 11 ) : array(); }
function get_page_by_path() { return null; }
function wp_insert_post( $fields, $error = false ) { update_option( 'fixture_post', array_merge( $fields, array( 'ID' => 11, 'sample_id' => $fields['meta_input']['_wp_starter_sample_id'] ) ) ); return 11; }
function wp_update_post( $fields, $error = false ) { update_option( 'fixture_post', array_merge( get_option( 'fixture_post' ), $fields ) ); return 11; }
function get_post( $id ) { $post = get_option( 'fixture_post' ); if ( get_option( 'fixture_corrupt' ) ) $post['post_name'] = 'unexpected'; return (object) $post; }
function wp_set_object_terms() { return array(); }
function wp_get_object_terms() { return array(); }
function delete_post_thumbnail() {}
function set_post_format() {}
function unstick_post() {}
define( 'OBJECT', 'OBJECT' );
$_GET = array( 'page' => 'wp-starter-setup', 'wpstarter_step' => '1' );
require WPMU_PLUGIN_DIR . '/site-starter-bootstrap.php';
MMS_WP_Starter_Bootstrap::maybe_run();
persist();

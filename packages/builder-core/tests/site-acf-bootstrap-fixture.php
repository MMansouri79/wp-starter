<?php
require __DIR__ . '/sample-bootstrap-fixture.php';
function get_post_meta( $id, $key, $single = true ) { return $GLOBALS['postmeta'][$id][$key] ?? ''; }
function update_post_meta( $id, $key, $value ) { $GLOBALS['postmeta'][$id][$key] = $value; return true; }
function acf_get_field_group( $key ) { return $GLOBALS['acf_groups'][$key] ?? false; }
function acf_import_field_group( $group ) { $group['ID'] = 200 + count( $GLOBALS['acf_groups'] ?? array() ); $GLOBALS['acf_groups'][$group['key']] = $group; foreach ( $group['fields'] as $field ) { $GLOBALS['acf_fields'][$field['key']] = $field; } return $group; }
function acf_get_field( $key ) { return $GLOBALS['acf_fields'][$key] ?? false; }
function update_field( $key, $value, $post_id ) { $GLOBALS['acf_values'][$post_id][$key] = $value; return true; }
function acf_get_value( $post_id, $field ) { return $GLOBALS['acf_values'][$post_id][$field['key']] ?? false; }
$row = array( 'id' => 'post-acf', 'kind' => 'post', 'title' => 'ACF post', 'slug' => 'acf-post', 'content' => '', 'excerpt' => '', 'status' => 'draft', 'categoryIds' => array(), 'tagIds' => array(), 'acf' => array( 'groups' => array( array( 'key' => 'group_import', 'title' => 'Imported fields', 'location' => array( array( array( 'param' => 'post_type', 'operator' => '==', 'value' => 'post' ) ) ), 'fields' => array( array( 'key' => 'field_nested', 'name' => 'nested', 'type' => 'group', 'label' => 'Nested' ) ) ) ), 'values' => array( 'field_nested' => array( 'field_text' => 'Preserved value', 'field_link' => array( '$siteRef' => 'content', 'id' => 'post-acf' ), 'field_term' => array( '$siteRef' => 'term', 'id' => 'child' ) ) ) ) );
$acf = new MMS_WP_Starter_Sample_Content( array( 'content' => array( $row ), 'terms' => array( $child ) ), __DIR__ );
$id = $acf->install_post( $row );
check( is_int( $id ), 'ACF content must stage as draft.' );
check( true === $acf->install_acf( $row ), 'ACF definitions and values must import.' );
check( $GLOBALS['acf_values'][$id]['field_nested']['field_link'] === $id, 'ACF content references must use destination IDs.' );
check( $GLOBALS['acf_values'][$id]['field_nested']['field_term'] === 2, 'ACF term references must use destination IDs.' );
check( $GLOBALS['acf_values'][$id]['field_nested']['field_text'] === 'Preserved value', 'Nested ACF text must survive.' );
check( true === $acf->install_acf( $row ) && count( $GLOBALS['acf_groups'] ) === 1, 'Retry must not duplicate groups or fail unchanged values.' );
$GLOBALS['postmeta'][200]['_wp_starter_acf_hash'] = 'unrelated';
check( is_wp_error( $acf->install_acf( $row ) ), 'Unrelated ACF groups must not be overwritten.' );
echo "PASS ACF persistent definitions, nested values, references, conflicts and retries\n";
$variable['variations'][0]['menuOrder'] = 7;
check( is_int( $woo->install_product( $variable ) ), 'Variable update must succeed.' );
check( $GLOBALS['products'][$variant_id]->data['menu_order'] === 7, 'Variation ordering must survive installation.' );
